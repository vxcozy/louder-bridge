#ifndef LOUDER_MICRO_DEVICE_H
#define LOUDER_MICRO_DEVICE_H

int run_micro_device(void);
#if defined(LOUDER_TEST_BUILD)
int print_micro_frames(const char *transport, const char *payload);
int validate_micro_command(const char *payload);
#endif

#endif
