#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <IOKit/hidsystem/IOHIDLib.h>
#include <errno.h>
#include <fcntl.h>
#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

static int fresh_status_code(
  const char *executable,
  const char *argument
) {
  posix_spawn_file_actions_t actions;
  if (posix_spawn_file_actions_init(&actions) != 0) return 5;
  int null_output = open("/dev/null", O_WRONLY);
  if (null_output >= 0) {
    posix_spawn_file_actions_adddup2(
      &actions,
      null_output,
      STDOUT_FILENO
    );
    posix_spawn_file_actions_adddup2(
      &actions,
      null_output,
      STDERR_FILENO
    );
    posix_spawn_file_actions_addclose(&actions, null_output);
  }
  char *const arguments[] = {
    (char *)executable,
    (char *)argument,
    NULL
  };
  pid_t child;
  int spawn_error = posix_spawn(
    &child,
    executable,
    &actions,
    NULL,
    arguments,
    environ
  );
  posix_spawn_file_actions_destroy(&actions);
  if (null_output >= 0) close(null_output);
  if (spawn_error != 0) return 5;

  int status;
  while (waitpid(child, &status, 0) < 0) {
    if (errno != EINTR) return 5;
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : 5;
}

static const char *accessibility_name(Boolean trusted) {
  return trusted ? "granted" : "denied";
}

static Boolean check_accessibility_fresh(const char *executable) {
  return fresh_status_code(
    executable,
    "--accessibility-status-code"
  ) == 0;
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
    if (check_accessibility_fresh(executable)) return true;
    usleep(500000);
  }
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

static Boolean is_dictation_group(AXUIElementRef element) {
  if (
    !string_attribute_equals(element, kAXRoleAttribute, "AXGroup") ||
    !string_attribute_equals(
      element,
      kAXSubroleAttribute,
      "AXApplicationGroup"
    )
  ) {
    return false;
  }
  if (
    string_attribute_equals(
      element,
      kAXDescriptionAttribute,
      "Dictation"
    )
  ) {
    return true;
  }

  CGPoint group_position;
  CGSize group_size;
  if (
    !copy_rect(element, &group_position, &group_size) ||
    group_size.width < 30 ||
    group_size.width > 80 ||
    group_size.height < 18 ||
    group_size.height > 50
  ) {
    return false;
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
    return false;
  }
  CFArrayRef children = (CFArrayRef)children_value;
  Boolean found_popup = false;
  for (CFIndex index = 0; index < CFArrayGetCount(children); index += 1) {
    AXUIElementRef child = (AXUIElementRef)CFArrayGetValueAtIndex(
      children,
      index
    );
    if (
      string_attribute_equals(child, kAXRoleAttribute, "AXPopUpButton")
    ) {
      CGPoint popup_position;
      CGSize popup_size;
      if (
        copy_rect(child, &popup_position, &popup_size) &&
        popup_size.width < group_size.width &&
        popup_size.height <= group_size.height + 2
      ) {
        found_popup = true;
        break;
      }
    }
  }
  CFRelease(children_value);
  return found_popup;
}

typedef struct {
  AXUIElementRef dictation_group;
  AXUIElementRef stop_toggle;
  int remaining;
} DictationElements;

static AXUIElementRef find_toggle_descendant(
  AXUIElementRef element,
  int *remaining
) {
  if (*remaining <= 0) return NULL;
  *remaining -= 1;
  if (
    string_attribute_equals(element, kAXRoleAttribute, "AXCheckBox") &&
    string_attribute_equals(element, kAXSubroleAttribute, "AXToggleButton")
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
    match = find_toggle_descendant(
      (AXUIElementRef)CFArrayGetValueAtIndex(children, index),
      remaining
    );
    if (match != NULL) break;
  }
  CFRelease(children_value);
  return match;
}

static void find_dictation_elements(
  AXUIElementRef element,
  DictationElements *found
) {
  if (found->remaining <= 0) return;
  found->remaining -= 1;
  if (
    found->dictation_group == NULL &&
    is_dictation_group(element)
  ) {
    found->dictation_group = (AXUIElementRef)CFRetain(element);
    int toggle_budget = 128;
    found->stop_toggle = find_toggle_descendant(element, &toggle_budget);
    return;
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
    return;
  }
  CFArrayRef children = (CFArrayRef)children_value;
  for (
    CFIndex index = 0;
    index < CFArrayGetCount(children) && found->remaining > 0;
    index += 1
  ) {
    find_dictation_elements(
      (AXUIElementRef)CFArrayGetValueAtIndex(children, index),
      found
    );
    if (found->dictation_group != NULL) break;
  }
  CFRelease(children_value);
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

static Boolean activate_claude(void) {
  @autoreleasepool {
    NSArray<NSRunningApplication *> *applications =
      [NSRunningApplication runningApplicationsWithBundleIdentifier:
        @"com.anthropic.claudefordesktop"];
    NSRunningApplication *application = applications.firstObject;
    if (application == nil) return false;
    return [application activateWithOptions:0];
  }
}

static DictationElements inspect_claude_dictation(void) {
  DictationElements found = {
    .dictation_group = NULL,
    .stop_toggle = NULL,
    .remaining = 20000
  };
  pid_t process_identifier = claude_process_identifier();
  if (process_identifier == 0) return found;
  AXUIElementRef application = AXUIElementCreateApplication(
    process_identifier
  );
  find_dictation_elements(application, &found);
  CFRelease(application);
  return found;
}

static void release_dictation_elements(DictationElements *found) {
  if (found->dictation_group != NULL) {
    CFRelease(found->dictation_group);
    found->dictation_group = NULL;
  }
  if (found->stop_toggle != NULL) {
    CFRelease(found->stop_toggle);
    found->stop_toggle = NULL;
  }
}

static Boolean click_dictation_group(AXUIElementRef group) {
  CGPoint position;
  CGSize size;
  if (!copy_rect(group, &position, &size)) return false;
  CGPoint point = CGPointMake(
    position.x + fmin(size.width * 0.25, 12),
    position.y + size.height / 2
  );
  CGEventRef current = CGEventCreate(NULL);
  CGPoint previous = current == NULL
    ? point
    : CGEventGetLocation(current);
  if (current != NULL) CFRelease(current);

  CGEventRef down = CGEventCreateMouseEvent(
    NULL,
    kCGEventLeftMouseDown,
    point,
    kCGMouseButtonLeft
  );
  CGEventRef up = CGEventCreateMouseEvent(
    NULL,
    kCGEventLeftMouseUp,
    point,
    kCGMouseButtonLeft
  );
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
  usleep(30000);

  CGEventRef restore = CGEventCreateMouseEvent(
    NULL,
    kCGEventMouseMoved,
    previous,
    kCGMouseButtonLeft
  );
  if (restore != NULL) {
    CGEventPost(kCGHIDEventTap, restore);
    CFRelease(restore);
  }
  return true;
}

static int start_claude_dictation(void) {
  if (!AXIsProcessTrusted()) {
    fputs("Louder Bridge needs Accessibility permission.\n", stderr);
    return 3;
  }
  if (!activate_claude()) {
    fputs("Claude Desktop is not running.\n", stderr);
    return 4;
  }
  usleep(150000);
  DictationElements found = inspect_claude_dictation();
  if (found.stop_toggle != NULL) {
    release_dictation_elements(&found);
    return 0;
  }
  if (found.dictation_group == NULL) {
    fputs(
      "The active Claude Code composer does not expose dictation.\n",
      stderr
    );
    release_dictation_elements(&found);
    return 5;
  }
  Boolean clicked = click_dictation_group(found.dictation_group);
  release_dictation_elements(&found);
  if (!clicked) {
    fputs("Louder Bridge could not press Claude's dictation control.\n", stderr);
    return 6;
  }

  for (int attempt = 0; attempt < 30; attempt += 1) {
    usleep(100000);
    found = inspect_claude_dictation();
    Boolean recording = found.stop_toggle != NULL;
    release_dictation_elements(&found);
    if (recording) return 0;
  }
  fputs(
    "Claude did not start dictation. Check its microphone permission.\n",
    stderr
  );
  return 7;
}

static int stop_claude_dictation(void) {
  if (!AXIsProcessTrusted()) {
    fputs("Louder Bridge needs Accessibility permission.\n", stderr);
    return 3;
  }
  DictationElements found = inspect_claude_dictation();
  if (found.stop_toggle == NULL) {
    release_dictation_elements(&found);
    return 0;
  }
  AXError error = AXUIElementPerformAction(
    found.stop_toggle,
    kAXPressAction
  );
  release_dictation_elements(&found);
  if (error != kAXErrorSuccess) {
    fputs("Louder Bridge could not stop Claude dictation.\n", stderr);
    return 6;
  }
  for (int attempt = 0; attempt < 30; attempt += 1) {
    usleep(100000);
    found = inspect_claude_dictation();
    Boolean stopped = found.stop_toggle == NULL;
    release_dictation_elements(&found);
    if (stopped) return 0;
  }
  fputs("Claude dictation did not stop after MIC was released.\n", stderr);
  return 7;
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

static IOHIDAccessType check_access_fresh(const char *executable) {
  int status = fresh_status_code(
    executable,
    "--input-monitoring-status-code"
  );
  if (status == 0) return kIOHIDAccessTypeGranted;
  if (status == 3) return kIOHIDAccessTypeDenied;
  return kIOHIDAccessTypeUnknown;
}

static IOHIDAccessType request_input_monitoring(const char *executable) {
  IOHIDAccessType access = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);
  if (access == kIOHIDAccessTypeGranted) return access;

  IOHIDRequestAccess(kIOHIDRequestTypeListenEvent);
  for (;;) {
    access = check_access_fresh(executable);
    if (access == kIOHIDAccessTypeGranted) return access;
    usleep(500000);
  }
}

int main(int argc, char *argv[]) {
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
  if (argc > 1 && strcmp(argv[1], "--claude-dictation-start") == 0) {
    return start_claude_dictation();
  }
  if (argc > 1 && strcmp(argv[1], "--claude-dictation-stop") == 0) {
    return stop_claude_dictation();
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

  execl(node, node, cli, command, (char *)NULL);
  perror("Louder Bridge could not start its embedded runtime");
  return 1;
}
