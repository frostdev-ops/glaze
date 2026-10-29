// What the agent says about the app that started it; the host passes it on as the connection's peer. Self-reported, so
// never verified. Linux: the parent's program, from /proc. macOS: the app's bundle id, which macOS puts in the environment
// of what an app launches (this file never starts a process to ask). Windows: nothing beyond the parent's pid.
'use strict';
const fs = require('node:fs');

const STR = 4096;
const BUNDLE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/;

const self = ({ platform = process.platform, env = process.env, ppid = process.ppid, readlink = fs.readlinkSync } = {}) => {
  const out = {};
  if (platform === 'linux') {
    try {
      // A program replaced since it started (an update) reads as "<path> (deleted)".
      const exe = String(readlink(`/proc/${ppid}/exe`)).replace(/ \(deleted\)$/, '');
      if (exe && exe.length <= STR) out.exe = exe;
    } catch { /* gone, or not ours to read */ }
  } else if (platform === 'darwin') {
    const id = env.__CFBundleIdentifier;
    if (typeof id === 'string' && BUNDLE.test(id)) out.exe = id;
  }
  if (Number.isSafeInteger(ppid) && ppid >= 0) out.ppid = ppid;
  out.verified = false;
  return out;
};

module.exports = { self };
