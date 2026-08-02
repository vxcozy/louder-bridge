#import <Foundation/Foundation.h>
#include <IOKit/hid/IOHIDDevice.h>
#include <IOKit/hid/IOHIDKeys.h>
#include <IOKit/IOKitLib.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include "micro_device.h"

static const int MICRO_VENDOR_ID = 0x303A;
static const int MICRO_PRODUCT_ID = 0x8360;
static const CFIndex MICRO_REPORT_ID = 6;
static const CFIndex MICRO_CHUNK_BYTES = 61;
static const NSUInteger MICRO_MAX_MESSAGE_BYTES = 64 * 1024;
enum {
  MICRO_USB_REPORT_BYTES = 63,
  MICRO_BLE_REPORT_BYTES = 64
};

static volatile sig_atomic_t micro_should_stop = 0;
static volatile sig_atomic_t micro_removed = 0;
static NSMutableData *micro_report_buffer = nil;
static BOOL micro_status_verified = NO;
static NSDictionary *micro_status = nil;
static NSString *micro_transport = nil;

static void stop_micro_device(int signal_number) {
  (void)signal_number;
  micro_should_stop = 1;
}

static NSNumber *number_property(io_service_t service, CFStringRef key) {
  CFTypeRef value = IORegistryEntryCreateCFProperty(
    service,
    key,
    kCFAllocatorDefault,
    0
  );
  if (value == NULL) return nil;
  NSNumber *number = nil;
  if (CFGetTypeID(value) == CFNumberGetTypeID()) {
    number = [(__bridge NSNumber *)value copy];
  }
  CFRelease(value);
  return number;
}

static NSString *string_property(io_service_t service, CFStringRef key) {
  CFTypeRef value = IORegistryEntryCreateCFProperty(
    service,
    key,
    kCFAllocatorDefault,
    0
  );
  if (value == NULL) return nil;
  NSString *string = nil;
  if (CFGetTypeID(value) == CFStringGetTypeID()) {
    string = [(__bridge NSString *)value copy];
  }
  CFRelease(value);
  return string;
}

static IOHIDDeviceRef create_micro_device(void) {
  CFMutableDictionaryRef matching = IOServiceMatching("IOHIDDevice");
  if (matching == NULL) return NULL;
  io_iterator_t iterator = IO_OBJECT_NULL;
  kern_return_t result = IOServiceGetMatchingServices(
    kIOMainPortDefault,
    matching,
    &iterator
  );
  if (result != KERN_SUCCESS) return NULL;

  IOHIDDeviceRef device = NULL;
  io_service_t service;
  while ((service = IOIteratorNext(iterator)) != IO_OBJECT_NULL) {
    NSNumber *vendor = number_property(service, CFSTR(kIOHIDVendorIDKey));
    NSNumber *product = number_property(service, CFSTR(kIOHIDProductIDKey));
    if (
      vendor.intValue == MICRO_VENDOR_ID &&
      product.intValue == MICRO_PRODUCT_ID
    ) {
      device = IOHIDDeviceCreate(kCFAllocatorDefault, service);
      micro_transport =
        string_property(service, CFSTR(kIOHIDTransportKey)) ?: @"Unknown";
      IOObjectRelease(service);
      break;
    }
    IOObjectRelease(service);
  }
  IOObjectRelease(iterator);
  return device;
}

static BOOL is_bluetooth_transport(void) {
  return [micro_transport isEqualToString:@"Bluetooth Low Energy"];
}

static BOOL write_json_line(NSDictionary *message) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:message
                                                 options:0
                                                   error:&error];
  if (data == nil || error != nil) return NO;
  if (fwrite(data.bytes, 1, data.length, stdout) != data.length) return NO;
  if (fwrite("\n", 1, 1, stdout) != 1) return NO;
  return fflush(stdout) == 0;
}

static void emit_connected(void) {
  if (!micro_status_verified || micro_status == nil) return;
  write_json_line(@{
    @"_louder": @{
      @"type": @"connected",
      @"transport": micro_transport ?: @"Unknown",
      @"status": micro_status
    }
  });
}

static void process_device_message(NSData *line) {
  if (line.length == 0 || line.length > MICRO_MAX_MESSAGE_BYTES) return;
  NSError *error = nil;
  id object = [NSJSONSerialization JSONObjectWithData:line
                                              options:0
                                                error:&error];
  if (
    error != nil ||
    ![object isKindOfClass:[NSDictionary class]]
  ) {
    return;
  }
  NSDictionary *message = (NSDictionary *)object;
  if (
    !micro_status_verified &&
    [message[@"id"] isEqual:@1] &&
    [message[@"result"] isKindOfClass:[NSDictionary class]]
  ) {
    micro_status_verified = YES;
    micro_status = message[@"result"];
    emit_connected();
  }
  write_json_line(message);
}

static void decode_report(const uint8_t *report, CFIndex length) {
  if (report == NULL || length < 2) return;
  CFIndex start;
  if (
    length >= 3 &&
    report[0] == MICRO_REPORT_ID &&
    report[1] == 0x02
  ) {
    start = 1;
  } else if (report[0] == 0x02) {
    start = 0;
  } else {
    return;
  }
  NSUInteger body_length = report[start + 1];
  if (
    body_length > MICRO_CHUNK_BYTES ||
    start + 2 + (CFIndex)body_length > length
  ) {
    return;
  }
  if (
    micro_report_buffer.length + body_length >
    MICRO_MAX_MESSAGE_BYTES
  ) {
    [micro_report_buffer setLength:0];
    return;
  }
  [micro_report_buffer appendBytes:report + start + 2 length:body_length];

  static const uint8_t delimiter_bytes[] = {'\r', '\n'};
  NSData *delimiter = [NSData dataWithBytesNoCopy:(void *)delimiter_bytes
                                          length:sizeof(delimiter_bytes)
                                    freeWhenDone:NO];
  for (;;) {
    NSRange range = [micro_report_buffer
      rangeOfData:delimiter
      options:0
      range:NSMakeRange(0, micro_report_buffer.length)
    ];
    if (range.location == NSNotFound) break;
    NSData *line = [micro_report_buffer
      subdataWithRange:NSMakeRange(0, range.location)
    ];
    [micro_report_buffer
      replaceBytesInRange:NSMakeRange(0, NSMaxRange(range))
      withBytes:NULL
      length:0
    ];
    process_device_message(line);
  }
}

static void input_report_callback(
  void *context,
  IOReturn result,
  void *sender,
  IOHIDReportType type,
  uint32_t report_id,
  uint8_t *report,
  CFIndex report_length
) {
  (void)context;
  (void)sender;
  (void)type;
  if (
    result != kIOReturnSuccess ||
    report_id != MICRO_REPORT_ID
  ) {
    return;
  }
  @autoreleasepool {
    decode_report(report, report_length);
  }
}

static void removal_callback(
  void *context,
  IOReturn result,
  void *sender
) {
  (void)context;
  (void)result;
  (void)sender;
  micro_removed = 1;
  micro_should_stop = 1;
}

static CFIndex build_report(
  BOOL bluetooth,
  const uint8_t *bytes,
  NSUInteger remaining,
  uint8_t report[MICRO_BLE_REPORT_BYTES],
  NSUInteger *chunk_length
) {
  memset(report, 0, MICRO_BLE_REPORT_BYTES);
  NSUInteger chunk = MIN(remaining, (NSUInteger)MICRO_CHUNK_BYTES);
  CFIndex prefix = bluetooth ? 1 : 0;
  if (bluetooth) report[0] = (uint8_t)MICRO_REPORT_ID;
  report[prefix] = 0x02;
  report[prefix + 1] = (uint8_t)chunk;
  memcpy(report + prefix + 2, bytes, chunk);
  *chunk_length = chunk;
  return bluetooth ? MICRO_BLE_REPORT_BYTES : MICRO_USB_REPORT_BYTES;
}

static IOReturn send_payload(
  IOHIDDeviceRef device,
  NSData *payload
) {
  NSMutableData *terminated = [payload mutableCopy];
  static const uint8_t delimiter[] = {'\r', '\n'};
  [terminated appendBytes:delimiter length:sizeof(delimiter)];
  const uint8_t *bytes = terminated.bytes;
  NSUInteger remaining = terminated.length;
  NSUInteger offset = 0;
  BOOL bluetooth = is_bluetooth_transport();

  while (remaining > 0) {
    uint8_t report[MICRO_BLE_REPORT_BYTES];
    NSUInteger chunk;
    CFIndex report_length = build_report(
      bluetooth,
      bytes + offset,
      remaining,
      report,
      &chunk
    );
    IOReturn result = IOHIDDeviceSetReport(
      device,
      kIOHIDReportTypeOutput,
      MICRO_REPORT_ID,
      report,
      report_length
    );
    if (result != kIOReturnSuccess) return result;
    offset += chunk;
    remaining -= chunk;
  }
  return kIOReturnSuccess;
}

#if defined(LOUDER_TEST_BUILD)
int print_micro_frames(const char *transport, const char *payload) {
  @autoreleasepool {
    if (transport == NULL || payload == NULL) return 2;
    BOOL bluetooth = strcmp(transport, "bluetooth") == 0;
    if (!bluetooth && strcmp(transport, "usb") != 0) return 2;
    NSData *data = [NSData dataWithBytes:payload length:strlen(payload)];
    NSMutableData *terminated = [data mutableCopy];
    static const uint8_t delimiter[] = {'\r', '\n'};
    [terminated appendBytes:delimiter length:sizeof(delimiter)];
    const uint8_t *bytes = terminated.bytes;
    NSUInteger remaining = terminated.length;
    NSUInteger offset = 0;
    while (remaining > 0) {
      uint8_t report[MICRO_BLE_REPORT_BYTES];
      NSUInteger chunk;
      CFIndex report_length = build_report(
        bluetooth,
        bytes + offset,
        remaining,
        report,
        &chunk
      );
      for (CFIndex index = 0; index < report_length; index += 1) {
        printf("%02x", report[index]);
      }
      putchar('\n');
      offset += chunk;
      remaining -= chunk;
    }
    return 0;
  }
}
#endif

static BOOL allowed_method(NSString *method) {
  return
    [method isEqualToString:@"device.status"] ||
    [method isEqualToString:@"v.oai.rgbcfg"] ||
    [method isEqualToString:@"v.oai.thstatus"];
}

static BOOL valid_host_command(id object) {
  if (![object isKindOfClass:[NSDictionary class]]) return NO;
  NSString *method = ((NSDictionary *)object)[@"m"];
  return
    [method isKindOfClass:[NSString class]] &&
    allowed_method(method);
}

#if defined(LOUDER_TEST_BUILD)
int validate_micro_command(const char *payload) {
  @autoreleasepool {
    if (payload == NULL) return 2;
    NSData *data = [NSData dataWithBytes:payload length:strlen(payload)];
    if (data.length == 0 || data.length > MICRO_MAX_MESSAGE_BYTES) return 2;
    NSError *error = nil;
    id object = [NSJSONSerialization JSONObjectWithData:data
                                                options:0
                                                  error:&error];
    return error == nil && valid_host_command(object) ? 0 : 2;
  }
}
#endif

static BOOL process_host_command(
  IOHIDDeviceRef device,
  NSData *line
) {
  if (line.length == 0) return YES;
  if (line.length > MICRO_MAX_MESSAGE_BYTES) {
    fputs("Louder Bridge rejected an oversized device command.\n", stderr);
    return NO;
  }
  NSError *error = nil;
  id object = [NSJSONSerialization JSONObjectWithData:line
                                              options:0
                                                error:&error];
  if (
    error != nil ||
    ![object isKindOfClass:[NSDictionary class]]
  ) {
    fputs("Louder Bridge received an invalid device command.\n", stderr);
    return NO;
  }
  NSDictionary *message = (NSDictionary *)object;
  if (!valid_host_command(message)) {
    fputs("Louder Bridge rejected an unsupported device command.\n", stderr);
    return NO;
  }
  NSData *payload = [NSJSONSerialization dataWithJSONObject:message
                                                    options:0
                                                      error:&error];
  if (payload == nil || error != nil) return NO;
  IOReturn result = send_payload(device, payload);
  if (result != kIOReturnSuccess) {
    fprintf(
      stderr,
      "Codex Micro rejected a device report (0x%08x).\n",
      result
    );
    return NO;
  }
  return YES;
}

static BOOL drain_stdin(
  IOHIDDeviceRef device,
  NSMutableData *buffer,
  BOOL *closed
) {
  uint8_t bytes[4096];
  for (;;) {
    ssize_t count = read(STDIN_FILENO, bytes, sizeof(bytes));
    if (count > 0) {
      if (
        buffer.length + (NSUInteger)count >
        MICRO_MAX_MESSAGE_BYTES
      ) {
        fputs("Louder Bridge device input exceeded 64 KiB.\n", stderr);
        return NO;
      }
      [buffer appendBytes:bytes length:(NSUInteger)count];
      continue;
    }
    if (count == 0) {
      *closed = YES;
      break;
    }
    if (errno == EAGAIN || errno == EWOULDBLOCK) break;
    if (errno == EINTR) continue;
    perror("Louder Bridge could not read a device command");
    return NO;
  }

  static const uint8_t newline = '\n';
  NSData *delimiter = [NSData dataWithBytesNoCopy:(void *)&newline
                                          length:1
                                    freeWhenDone:NO];
  for (;;) {
    NSRange range = [buffer
      rangeOfData:delimiter
      options:0
      range:NSMakeRange(0, buffer.length)
    ];
    if (range.location == NSNotFound) break;
    NSData *line = [buffer subdataWithRange:NSMakeRange(0, range.location)];
    [buffer
      replaceBytesInRange:NSMakeRange(0, NSMaxRange(range))
      withBytes:NULL
      length:0
    ];
    if (!process_host_command(device, line)) return NO;
  }
  return YES;
}

int run_micro_device(void) {
  @autoreleasepool {
    micro_should_stop = 0;
    micro_removed = 0;
    micro_status_verified = NO;
    micro_status = nil;
    micro_transport = nil;
    micro_report_buffer = [NSMutableData data];

    IOHIDDeviceRef device = create_micro_device();
    if (device == NULL) {
      fputs("Codex Micro was not found.\n", stderr);
      return 4;
    }
    IOReturn open_result = IOHIDDeviceOpen(device, kIOHIDOptionsTypeNone);
    if (open_result != kIOReturnSuccess) {
      fprintf(
        stderr,
        "Codex Micro could not be opened (0x%08x). Check Input Monitoring.\n",
        open_result
      );
      CFRelease(device);
      return 5;
    }

    uint8_t input_buffer[MICRO_BLE_REPORT_BYTES] = {0};
    IOHIDDeviceRegisterInputReportCallback(
      device,
      input_buffer,
      sizeof(input_buffer),
      input_report_callback,
      NULL
    );
    IOHIDDeviceRegisterRemovalCallback(
      device,
      removal_callback,
      NULL
    );
    CFRunLoopRef run_loop = CFRunLoopGetCurrent();
    IOHIDDeviceScheduleWithRunLoop(
      device,
      run_loop,
      kCFRunLoopDefaultMode
    );

    struct sigaction action = {0};
    action.sa_handler = stop_micro_device;
    sigemptyset(&action.sa_mask);
    sigaction(SIGINT, &action, NULL);
    sigaction(SIGTERM, &action, NULL);

    int flags = fcntl(STDIN_FILENO, F_GETFL);
    if (flags >= 0) {
      fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK);
    }

    NSError *error = nil;
    NSData *status_request = [NSJSONSerialization
      dataWithJSONObject:@{@"m": @"device.status", @"id": @1}
      options:0
      error:&error
    ];
    IOReturn status_result =
      status_request == nil
        ? kIOReturnError
        : send_payload(device, status_request);
    if (status_result != kIOReturnSuccess) {
      fputs("Louder Bridge could not query Codex Micro status.\n", stderr);
      micro_should_stop = 1;
    }

    NSMutableData *stdin_buffer = [NSMutableData data];
    BOOL stdin_closed = NO;
    CFAbsoluteTime status_deadline = CFAbsoluteTimeGetCurrent() + 2.0;
    BOOL success = YES;
    while (!micro_should_stop) {
      CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, true);
      if (!drain_stdin(device, stdin_buffer, &stdin_closed)) {
        success = NO;
        break;
      }
      if (stdin_closed) {
        if (!micro_status_verified) {
          fputs(
            "Codex Micro connection closed before the status check completed.\n",
            stderr
          );
          success = NO;
        }
        break;
      }
      if (
        !micro_status_verified &&
        CFAbsoluteTimeGetCurrent() >= status_deadline
      ) {
        fputs(
          "Codex Micro did not answer the device status check.\n",
          stderr
        );
        success = NO;
        break;
      }
    }

    IOHIDDeviceUnscheduleFromRunLoop(
      device,
      run_loop,
      kCFRunLoopDefaultMode
    );
    IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
    CFRelease(device);
    if (micro_removed) {
      write_json_line(@{@"_louder": @{@"type": @"disconnected"}});
    }
    micro_report_buffer = nil;
    micro_status = nil;
    micro_transport = nil;
    return success ? 0 : 6;
  }
}
