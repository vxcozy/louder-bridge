class Discovery {
  findWLDevices() {
    return [];
  }
}

module.exports = {
  DeviceType: { CodexMicro: 1 },
  ConnectionEventType: { DISCONNECTED: "disconnected", ERROR: "error" },
  WLDeviceDiscovery: Discovery,
  WLDeviceCommImpl: class {},
  RPCApiOAI: class {},
};
