#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <IOKit/hidsystem/IOHIDLib.h>
#include <errno.h>
#include <fcntl.h>
#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include "micro_device.h"

extern char **environ;

static volatile sig_atomic_t runtime_process = 0;
static volatile sig_atomic_t hold_stop_requested = 0;

static void forward_signal(int signal_number) {
  pid_t process = (pid_t)runtime_process;
  if (process > 0) kill(process, signal_number);
}

static void request_hold_stop(int signal_number) {
  (void)signal_number;
  hold_stop_requested = 1;
}

static int run_runtime(
  const char *node,
  const char *cli,
  const char *command
) {
  char *const arguments[] = {
    (char *)node,
    (char *)cli,
    (char *)command,
    NULL
  };
  pid_t process;
  int spawn_error = posix_spawn(
    &process,
    node,
    NULL,
    NULL,
    arguments,
    environ
  );
  if (spawn_error != 0) {
    errno = spawn_error;
    perror("Louder Bridge could not start its embedded runtime");
    return 1;
  }

  runtime_process = process;
  signal(SIGINT, forward_signal);
  signal(SIGTERM, forward_signal);

  int status;
  while (waitpid(process, &status, 0) < 0) {
    if (errno != EINTR) {
      perror("Louder Bridge could not wait for its embedded runtime");
      return 1;
    }
  }
  runtime_process = 0;
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}

static const char *accessibility_name(Boolean trusted) {
  return trusted ? "granted" : "denied";
}

static Boolean copy_string_attribute(
  AXUIElementRef element,
  CFStringRef attribute,
  char *output,
  size_t output_size
) {
  CFTypeRef value = NULL;
  if (
    AXUIElementCopyAttributeValue(element, attribute, &value) !=
      kAXErrorSuccess ||
    value == NULL ||
    CFGetTypeID(value) != CFStringGetTypeID()
  ) {
    if (value != NULL) CFRelease(value);
    return false;
  }
  Boolean success = CFStringGetCString(
    (CFStringRef)value,
    output,
    output_size,
    kCFStringEncodingUTF8
  );
  CFRelease(value);
  return success;
}

static Boolean string_attribute_equals(
  AXUIElementRef element,
  CFStringRef attribute,
  const char *expected
) {
  char value[256];
  return copy_string_attribute(element, attribute, value, sizeof(value)) &&
    strcmp(value, expected) == 0;
}

static Boolean copy_rect(
  AXUIElementRef element,
  CGPoint *position,
  CGSize *size
) {
  CFTypeRef position_value = NULL;
  CFTypeRef size_value = NULL;
  AXError position_error = AXUIElementCopyAttributeValue(
    element,
    kAXPositionAttribute,
    &position_value
  );
  AXError size_error = AXUIElementCopyAttributeValue(
    element,
    kAXSizeAttribute,
    &size_value
  );
  Boolean success =
    position_error == kAXErrorSuccess &&
    size_error == kAXErrorSuccess &&
    position_value != NULL &&
    size_value != NULL &&
    CFGetTypeID(position_value) == AXValueGetTypeID() &&
    CFGetTypeID(size_value) == AXValueGetTypeID() &&
    AXValueGetValue((AXValueRef)position_value, kAXValueCGPointType, position) &&
    AXValueGetValue((AXValueRef)size_value, kAXValueCGSizeType, size);
  if (position_value != NULL) CFRelease(position_value);
  if (size_value != NULL) CFRelease(size_value);
  return success;
}

static pid_t claude_process_identifier(void) {
  @autoreleasepool {
    NSArray<NSRunningApplication *> *applications =
      [NSRunningApplication runningApplicationsWithBundleIdentifier:
        @"com.anthropic.claudefordesktop"];
    NSRunningApplication *application = applications.firstObject;
    return application == nil ? 0 : application.processIdentifier;
  }
}

static Boolean frontmost_application_is_claude(void) {
  @autoreleasepool {
    NSRunningApplication *application =
      [NSWorkspace sharedWorkspace].frontmostApplication;
    return [application.bundleIdentifier
      isEqualToString:@"com.anthropic.claudefordesktop"];
  }
}

typedef enum {
  kComposerButtonMissing = 0,
  kComposerButtonHold = 1,
  kComposerButtonToggle = 2,
  kComposerButtonActive = 3
} ComposerButtonMode;

static Boolean composer_button_uses_toggle(ComposerButtonMode mode) {
  return mode == kComposerButtonToggle;
}

static int print_composer_gesture_plan(const char *mode) {
  ComposerButtonMode button_mode;
  if (strcmp(mode, "hold") == 0) {
    button_mode = kComposerButtonHold;
  } else if (strcmp(mode, "toggle") == 0) {
    button_mode = kComposerButtonToggle;
  } else {
    return 2;
  }
  puts(
    composer_button_uses_toggle(button_mode)
      ? "click click"
      : "mouse-down mouse-up"
  );
  return 0;
}

static Boolean element_label_equals(
  AXUIElementRef element,
  const char *expected
) {
  return
    string_attribute_equals(element, kAXDescriptionAttribute, expected) ||
    string_attribute_equals(element, kAXTitleAttribute, expected);
}

static ComposerButtonMode composer_button_mode(AXUIElementRef element) {
  if (!string_attribute_equals(element, kAXRoleAttribute, "AXButton")) {
    return kComposerButtonMissing;
  }
  if (element_label_equals(element, "Press and hold to record")) {
    return kComposerButtonHold;
  }
  if (
    element_label_equals(element, "Dictate") ||
    element_label_equals(element, "Turn on microphone")
  ) {
    return kComposerButtonToggle;
  }
  if (element_label_equals(element, "Stop dictation")) {
    return kComposerButtonActive;
  }
  return kComposerButtonMissing;
}

static AXUIElementRef find_record_button(
  AXUIElementRef element,
  ComposerButtonMode *mode,
  int *remaining
) {
  if (*remaining <= 0) return NULL;
  *remaining -= 1;
  ComposerButtonMode candidate = composer_button_mode(element);
  if (candidate != kComposerButtonMissing) {
    *mode = candidate;
    return (AXUIElementRef)CFRetain(element);
  }

  CFTypeRef children_value = NULL;
  if (
    AXUIElementCopyAttributeValue(
      element,
      kAXChildrenAttribute,
      &children_value
    ) != kAXErrorSuccess ||
    children_value == NULL ||
    CFGetTypeID(children_value) != CFArrayGetTypeID()
  ) {
    if (children_value != NULL) CFRelease(children_value);
    return NULL;
  }
  CFArrayRef children = (CFArrayRef)children_value;
  AXUIElementRef match = NULL;
  for (
    CFIndex index = 0;
    index < CFArrayGetCount(children) && *remaining > 0;
    index += 1
  ) {
    match = find_record_button(
      (AXUIElementRef)CFArrayGetValueAtIndex(children, index),
      mode,
      remaining
    );
    if (match != NULL) break;
  }
  CFRelease(children_value);
  return match;
}

static AXUIElementRef focused_claude_record_button(
  ComposerButtonMode *mode
) {
  pid_t process_identifier = claude_process_identifier();
  if (process_identifier == 0) return NULL;
  AXUIElementRef application = AXUIElementCreateApplication(
    process_identifier
  );
  CFTypeRef focused_window = NULL;
  AXError error = AXUIElementCopyAttributeValue(
    application,
    kAXFocusedWindowAttribute,
    &focused_window
  );
  CFRelease(application);
  if (
    error != kAXErrorSuccess ||
    focused_window == NULL ||
    CFGetTypeID(focused_window) != AXUIElementGetTypeID()
  ) {
    if (focused_window != NULL) CFRelease(focused_window);
    return NULL;
  }
  int remaining = 20000;
  AXUIElementRef button = find_record_button(
    (AXUIElementRef)focused_window,
    mode,
    &remaining
  );
  CFRelease(focused_window);
  return button;
}

static CGEventRef mouse_event(CGEventType type, CGPoint point) {
  return CGEventCreateMouseEvent(
    NULL,
    type,
    point,
    kCGMouseButtonLeft
  );
}

static int wait_for_stop_signal(void) {
  char byte;
  while (!hold_stop_requested) {
    fd_set input;
    FD_ZERO(&input);
    FD_SET(STDIN_FILENO, &input);
    struct timeval timeout = { .tv_sec = 0, .tv_usec = 100000 };
    int selected = select(
      STDIN_FILENO + 1,
      &input,
      NULL,
      NULL,
      &timeout
    );
    if (selected > 0) {
      ssize_t count = read(STDIN_FILENO, &byte, 1);
      if (count >= 0) return 0;
      if (errno != EINTR) return 1;
    } else if (selected < 0 && errno != EINTR) {
      return 1;
    }
  }
  return 0;
}

static Boolean click_accessibility_button(AXUIElementRef button) {
  return AXUIElementPerformAction(button, kAXPressAction) == kAXErrorSuccess;
}

static Boolean click_point(CGPoint point) {
  CGEventRef down = mouse_event(kCGEventLeftMouseDown, point);
  CGEventRef up = mouse_event(kCGEventLeftMouseUp, point);
  if (down == NULL || up == NULL) {
    if (down != NULL) CFRelease(down);
    if (up != NULL) CFRelease(up);
    return false;
  }
  CGEventPost(kCGHIDEventTap, down);
  usleep(30000);
  CGEventPost(kCGHIDEventTap, up);
  CFRelease(down);
  CFRelease(up);
  return true;
}

static int hold_composer_dictation(
  AXUIElementRef button,
  ComposerButtonMode mode
) {
  CGPoint position;
  CGSize size;
  if (!copy_rect(button, &position, &size)) {
    fputs("Louder Bridge could not locate Claude's dictation control.\n", stderr);
    return 6;
  }
  CGPoint point = CGPointMake(
    position.x + size.width / 2,
    position.y + size.height / 2
  );
  if (mode == kComposerButtonActive) {
    if (!click_point(point)) {
      fputs("Louder Bridge could not stop the active Claude dictation.\n", stderr);
      return 6;
    }
    fputs("Claude dictation was already running, so Louder Bridge stopped it. Press MIC again to start.\n", stderr);
    return 8;
  }

  Boolean uses_toggle = composer_button_uses_toggle(mode);
  if (uses_toggle) {
    if (!click_point(point)) {
      fputs("Louder Bridge could not start Claude dictation.\n", stderr);
      return 6;
    }
  } else {
    CGEventRef down = mouse_event(kCGEventLeftMouseDown, point);
    if (down == NULL) {
      fputs("Louder Bridge could not start Claude dictation.\n", stderr);
      return 6;
    }
    CGEventPost(kCGHIDEventTap, down);
    CFRelease(down);
  }
  CFAbsoluteTime pressed_at = CFAbsoluteTimeGetCurrent();
  usleep(50000);
  puts("ready claude-composer");
  fflush(stdout);
  int wait_error = wait_for_stop_signal();

  CFTimeInterval held_for = CFAbsoluteTimeGetCurrent() - pressed_at;
  if (held_for < 0.55) {
    usleep((useconds_t)((0.55 - held_for) * 1000000));
  }
  if (uses_toggle) {
    if (!click_point(point)) {
      fputs("Louder Bridge could not stop Claude dictation.\n", stderr);
      return 6;
    }
  } else {
    CGEventRef up = mouse_event(kCGEventLeftMouseUp, point);
    if (up == NULL) {
      fputs("Louder Bridge could not stop Claude dictation.\n", stderr);
      return 6;
    }
    CGEventPost(kCGHIDEventTap, up);
    CFRelease(up);
  }
  return wait_error == 0 ? 0 : 7;
}

static Boolean post_key_event(
  CGKeyCode key_code,
  Boolean pressed,
  Boolean repeated
) {
  CGEventRef event = CGEventCreateKeyboardEvent(NULL, key_code, pressed);
  if (event == NULL) return false;
  if (repeated) {
    CGEventSetIntegerValueField(
      event,
      kCGKeyboardEventAutorepeat,
      1
    );
  }
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
  return true;
}

static int submit_in_claude(void) {
  if (!AXIsProcessTrusted()) {
    fputs("Louder Bridge needs Accessibility permission.\n", stderr);
    return 3;
  }
  if (!frontmost_application_is_claude()) {
    fputs("Bring Claude to the front before using the send key.\n", stderr);
    return 4;
  }
  if (!post_key_event(36, true, false)) {
    fputs("Louder Bridge could not press Return in Claude.\n", stderr);
    return 6;
  }
  usleep(30000);
  if (!post_key_event(36, false, false)) {
    fputs("Louder Bridge could not release Return in Claude.\n", stderr);
    return 6;
  }
  return 0;
}

static AXUIElementRef find_element_by_identifier(
  AXUIElementRef element,
  const char *identifier,
  int *remaining
) {
  if (*remaining <= 0) return NULL;
  *remaining -= 1;
  if (
    string_attribute_equals(
      element,
      kAXIdentifierAttribute,
      identifier
    )
  ) {
    return (AXUIElementRef)CFRetain(element);
  }

  CFTypeRef children_value = NULL;
  if (
    AXUIElementCopyAttributeValue(
      element,
      kAXChildrenAttribute,
      &children_value
    ) != kAXErrorSuccess ||
    children_value == NULL ||
    CFGetTypeID(children_value) != CFArrayGetTypeID()
  ) {
    if (children_value != NULL) CFRelease(children_value);
    return NULL;
  }
  CFArrayRef children = (CFArrayRef)children_value;
  AXUIElementRef match = NULL;
  for (
    CFIndex index = 0;
    index < CFArrayGetCount(children) && *remaining > 0;
    index += 1
  ) {
    match = find_element_by_identifier(
      (AXUIElementRef)CFArrayGetValueAtIndex(children, index),
      identifier,
      remaining
    );
    if (match != NULL) break;
  }
  CFRelease(children_value);
  return match;
}

static AXUIElementRef claude_menu_item(const char *identifier) {
  pid_t process_identifier = claude_process_identifier();
  if (process_identifier == 0) return NULL;
  AXUIElementRef application = AXUIElementCreateApplication(
    process_identifier
  );
  CFTypeRef menu_bar = NULL;
  AXError error = AXUIElementCopyAttributeValue(
    application,
    kAXMenuBarAttribute,
    &menu_bar
  );
  CFRelease(application);
  if (
    error != kAXErrorSuccess ||
    menu_bar == NULL ||
    CFGetTypeID(menu_bar) != AXUIElementGetTypeID()
  ) {
    if (menu_bar != NULL) CFRelease(menu_bar);
    return NULL;
  }
  int remaining = 5000;
  AXUIElementRef item = find_element_by_identifier(
    (AXUIElementRef)menu_bar,
    identifier,
    &remaining
  );
  CFRelease(menu_bar);
  return item;
}

static Boolean accessibility_element_is_enabled(AXUIElementRef element) {
  CFTypeRef value = NULL;
  AXError error = AXUIElementCopyAttributeValue(
    element,
    kAXEnabledAttribute,
    &value
  );
  Boolean enabled =
    error == kAXErrorSuccess &&
    value != NULL &&
    CFGetTypeID(value) == CFBooleanGetTypeID() &&
    CFBooleanGetValue((CFBooleanRef)value);
  if (value != NULL) CFRelease(value);
  return enabled;
}

static int hold_system_dictation(void) {
  AXUIElementRef item = claude_menu_item("startDictation:");
  if (item == NULL) {
    fputs("Claude does not expose the macOS Dictation command.\n", stderr);
    return 5;
  }
  if (!accessibility_element_is_enabled(item)) {
    CFRelease(item);
    fputs("Click in the Claude Code composer before using the MIC key.\n", stderr);
    return 4;
  }
  Boolean started = click_accessibility_button(item);
  CFRelease(item);
  if (!started) {
    fputs("Louder Bridge could not start macOS Dictation in Claude.\n", stderr);
    return 6;
  }
  usleep(250000);
  puts("ready macos-dictation");
  fflush(stdout);

  int wait_error = wait_for_stop_signal();
  if (
    !post_key_event(53, true, false) ||
    !post_key_event(53, false, false)
  ) {
    fputs("Louder Bridge could not stop macOS Dictation.\n", stderr);
    return 6;
  }
  return wait_error == 0 ? 0 : 7;
}

static int hold_claude_dictation(void) {
  if (!AXIsProcessTrusted()) {
    fputs("Louder Bridge needs Accessibility permission.\n", stderr);
    return 3;
  }
  if (!frontmost_application_is_claude()) {
    fputs("Bring Claude to the front before using the MIC key.\n", stderr);
    return 4;
  }
  hold_stop_requested = 0;
  struct sigaction stop_action = { 0 };
  stop_action.sa_handler = request_hold_stop;
  sigemptyset(&stop_action.sa_mask);
  sigaction(SIGINT, &stop_action, NULL);
  sigaction(SIGTERM, &stop_action, NULL);

  ComposerButtonMode mode = kComposerButtonMissing;
  AXUIElementRef button = focused_claude_record_button(&mode);
  if (button == NULL) return hold_system_dictation();
  int result = hold_composer_dictation(button, mode);
  CFRelease(button);
  return result;
}

static const char *access_name(IOHIDAccessType access) {
  if (access == kIOHIDAccessTypeGranted) return "granted";
  if (access == kIOHIDAccessTypeDenied) return "denied";
  return "unknown";
}

static int resolve_executable(char resolved[PATH_MAX]) {
  char executable[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0) {
    fputs("Louder Bridge could not locate its application bundle.\n", stderr);
    return 1;
  }
  if (realpath(executable, resolved) == NULL) {
    perror("Louder Bridge could not resolve its application path");
    return 1;
  }
  return 0;
}

typedef struct {
  IOHIDAccessType input_monitoring;
  Boolean accessibility;
} PermissionProbe;

static Boolean permission_probe_path_is_safe(const char *path) {
  static const char prefix[] = "/tmp/app.louder-bridge.permission.";
  if (path == NULL || strncmp(path, prefix, strlen(prefix)) != 0) {
    return false;
  }
  const char *suffix = path + strlen(prefix);
  return suffix[0] != '\0' && strchr(suffix, '/') == NULL;
}

static int write_permission_probe(const char *path) {
  if (!permission_probe_path_is_safe(path)) return 2;
  int descriptor = open(path, O_WRONLY | O_NOFOLLOW);
  if (descriptor < 0) return 1;
  struct stat entry;
  if (
    fstat(descriptor, &entry) != 0 ||
    !S_ISREG(entry.st_mode) ||
    entry.st_uid != getuid() ||
    entry.st_nlink != 1 ||
    (entry.st_mode & 0777) != 0600 ||
    ftruncate(descriptor, 0) != 0
  ) {
    close(descriptor);
    return 1;
  }
  int input = (int)IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);
  int accessibility = AXIsProcessTrusted() ? 1 : 0;
  int written = dprintf(descriptor, "%d %d\n", input, accessibility);
  Boolean success = written > 0 && fsync(descriptor) == 0;
  if (close(descriptor) != 0) success = false;
  return success ? 0 : 1;
}

static Boolean application_path(
  const char *executable,
  char output[PATH_MAX]
) {
  if (strlen(executable) >= PATH_MAX) return false;
  char copy[PATH_MAX];
  strcpy(copy, executable);
  for (int level = 0; level < 3; level += 1) {
    char *directory = dirname(copy);
    if (directory != copy) memmove(copy, directory, strlen(directory) + 1);
  }
  size_t length = strlen(copy);
  if (length <= 4 || strcmp(copy + length - 4, ".app") != 0) {
    return false;
  }
  strcpy(output, copy);
  return true;
}

static Boolean read_permission_probe(
  int descriptor,
  PermissionProbe *probe
) {
  char contents[64];
  if (lseek(descriptor, 0, SEEK_SET) < 0) return false;
  ssize_t count = read(descriptor, contents, sizeof(contents) - 1);
  if (count <= 0) return false;
  contents[count] = '\0';
  int input;
  int accessibility;
  if (sscanf(contents, "%d %d", &input, &accessibility) != 2) return false;
  if (
    input != (int)kIOHIDAccessTypeGranted &&
    input != (int)kIOHIDAccessTypeDenied &&
    input != (int)kIOHIDAccessTypeUnknown
  ) {
    return false;
  }
  if (accessibility != 0 && accessibility != 1) return false;
  probe->input_monitoring = (IOHIDAccessType)input;
  probe->accessibility = accessibility == 1;
  return true;
}

static Boolean wait_for_probe_launcher(pid_t child, int *status) {
  for (int attempt = 0; attempt < 50; attempt += 1) {
    pid_t waited = waitpid(child, status, WNOHANG);
    if (waited == child) return true;
    if (waited < 0 && errno != EINTR) return false;
    usleep(100000);
  }
  kill(child, SIGTERM);
  for (int attempt = 0; attempt < 10; attempt += 1) {
    pid_t waited = waitpid(child, status, WNOHANG);
    if (waited == child) return false;
    if (waited < 0 && errno != EINTR) return false;
    usleep(100000);
  }
  kill(child, SIGKILL);
  while (waitpid(child, status, 0) < 0 && errno == EINTR) {}
  return false;
}

static Boolean probe_permissions_fresh(
  const char *executable,
  PermissionProbe *probe
) {
  char app[PATH_MAX];
  if (!application_path(executable, app)) return false;
  char probe_path[] = "/tmp/app.louder-bridge.permission.XXXXXX";
  int descriptor = mkstemp(probe_path);
  if (descriptor < 0) return false;
  if (fchmod(descriptor, 0600) != 0) {
    close(descriptor);
    unlink(probe_path);
    return false;
  }

  char *const arguments[] = {
    "/usr/bin/open",
    "-n",
    app,
    "--args",
    "--permission-probe",
    probe_path,
    NULL
  };
  pid_t child;
  int spawn_error = posix_spawn(
    &child,
    "/usr/bin/open",
    NULL,
    NULL,
    arguments,
    environ
  );
  Boolean success = false;
  if (spawn_error == 0) {
    int status;
    if (
      wait_for_probe_launcher(child, &status) &&
      WIFEXITED(status) &&
      WEXITSTATUS(status) == 0
    ) {
      for (int attempt = 0; attempt < 50; attempt += 1) {
        if (read_permission_probe(descriptor, probe)) {
          success = true;
          break;
        }
        usleep(100000);
      }
    }
  }
  close(descriptor);
  unlink(probe_path);
  return success;
}

static IOHIDAccessType request_input_monitoring(const char *executable) {
  IOHIDAccessType access = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);
  if (access == kIOHIDAccessTypeGranted) return access;

  IOHIDRequestAccess(kIOHIDRequestTypeListenEvent);
  for (;;) {
    PermissionProbe probe;
    if (
      probe_permissions_fresh(executable, &probe) &&
      probe.input_monitoring == kIOHIDAccessTypeGranted
    ) {
      return probe.input_monitoring;
    }
    usleep(500000);
  }
}

static Boolean request_accessibility(const char *executable) {
  if (AXIsProcessTrusted()) return true;
  const void *keys[] = { kAXTrustedCheckOptionPrompt };
  const void *values[] = { kCFBooleanTrue };
  CFDictionaryRef options = CFDictionaryCreate(
    kCFAllocatorDefault,
    keys,
    values,
    1,
    &kCFTypeDictionaryKeyCallBacks,
    &kCFTypeDictionaryValueCallBacks
  );
  AXIsProcessTrustedWithOptions(options);
  CFRelease(options);

  for (;;) {
    PermissionProbe probe;
    if (
      probe_permissions_fresh(executable, &probe) &&
      probe.accessibility
    ) {
      return true;
    }
    usleep(500000);
  }
}

int main(int argc, char *argv[]) {
  if (argc == 3 && strcmp(argv[1], "--permission-probe") == 0) {
    return write_permission_probe(argv[2]);
  }
  if (argc > 1 && strcmp(argv[1], "--permission-status-fresh") == 0) {
    char executable[PATH_MAX];
    if (resolve_executable(executable) != 0) return 1;
    PermissionProbe probe;
    if (!probe_permissions_fresh(executable, &probe)) return 5;
    printf(
      "%s %s\n",
      access_name(probe.input_monitoring),
      accessibility_name(probe.accessibility)
    );
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "--accessibility-status-code") == 0) {
    return AXIsProcessTrusted() ? 0 : 3;
  }
  if (argc > 1 && strcmp(argv[1], "--accessibility-status") == 0) {
    puts(accessibility_name(AXIsProcessTrusted()));
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "--request-accessibility") == 0) {
    char executable[PATH_MAX];
    if (resolve_executable(executable) != 0) return 1;
    Boolean trusted = request_accessibility(executable);
    puts(accessibility_name(trusted));
    return trusted ? 0 : 3;
  }
  if (argc > 1 && strcmp(argv[1], "--claude-dictation-hold") == 0) {
    return hold_claude_dictation();
  }
  if (argc > 1 && strcmp(argv[1], "--claude-submit") == 0) {
    return submit_in_claude();
  }
  if (argc > 1 && strcmp(argv[1], "--micro-device") == 0) {
    return run_micro_device();
  }
  if (
    argc == 4 &&
    strcmp(argv[1], "--test-micro-frame") == 0
  ) {
    return print_micro_frames(argv[2], argv[3]);
  }
  if (
    argc == 3 &&
    strcmp(argv[1], "--test-micro-command") == 0
  ) {
    return validate_micro_command(argv[2]);
  }
  if (
    argc == 3 &&
    strcmp(argv[1], "--test-composer-gesture") == 0
  ) {
    return print_composer_gesture_plan(argv[2]);
  }
  if (argc > 1 && strcmp(argv[1], "--input-monitoring-status-code") == 0) {
    IOHIDAccessType access =
      IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);
    if (access == kIOHIDAccessTypeGranted) return 0;
    if (access == kIOHIDAccessTypeDenied) return 3;
    return 4;
  }
  if (argc > 1 && strcmp(argv[1], "--input-monitoring-status") == 0) {
    IOHIDAccessType access =
      IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);
    puts(access_name(access));
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "--request-input-monitoring") == 0) {
    char executable[PATH_MAX];
    if (resolve_executable(executable) != 0) return 1;
    IOHIDAccessType access = request_input_monitoring(executable);
    puts(access_name(access));
    return access == kIOHIDAccessTypeGranted ? 0 : 3;
  }

  char resolved[PATH_MAX];
  if (resolve_executable(resolved) != 0) return 1;

  char macos_directory[PATH_MAX];
  strncpy(macos_directory, resolved, sizeof(macos_directory) - 1);
  macos_directory[sizeof(macos_directory) - 1] = '\0';
  char *contents_directory = dirname(macos_directory);
  contents_directory = dirname(contents_directory);

  char node[PATH_MAX];
  char cli[PATH_MAX];
  if (
    snprintf(node, sizeof(node), "%s/MacOS/node", contents_directory) >=
      (int)sizeof(node) ||
    snprintf(
      cli,
      sizeof(cli),
      "%s/Resources/app/src/cli.mjs",
      contents_directory
    ) >= (int)sizeof(cli)
  ) {
    fputs("Louder Bridge application path is too long.\n", stderr);
    return 1;
  }
  setenv("LOUDER_BRIDGE_LAUNCHER", resolved, 1);

  const char *command = "activate";
  if (argc > 1) {
    if (strcmp(argv[1], "--uninstall") == 0) command = "uninstall";
    else if (strcmp(argv[1], "--status") == 0) command = "status";
    else if (strcmp(argv[1], "--doctor") == 0) command = "doctor";
    else if (strcmp(argv[1], "--service") == 0) command = "service";
    else if (
      strcmp(argv[1], "--help") == 0 ||
      strcmp(argv[1], "-h") == 0
    ) command = "help";
    else if (
      strcmp(argv[1], "--version") == 0 ||
      strcmp(argv[1], "-V") == 0
    ) command = "version";
    else {
      fprintf(stderr, "Unknown Louder Bridge option: %s\n", argv[1]);
      return 2;
    }
  }

  if (argc == 1) {
    IOHIDAccessType access = request_input_monitoring(resolved);
    setenv("LOUDER_INPUT_MONITORING_STATUS", access_name(access), 1);
    Boolean accessibility = request_accessibility(resolved);
    setenv(
      "LOUDER_ACCESSIBILITY_STATUS",
      accessibility_name(accessibility),
      1
    );
  }

  return run_runtime(node, cli, command);
}
