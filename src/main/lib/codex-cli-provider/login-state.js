'use strict';

let loginStatusCache = null;
let activeCodexLogin = null;

function invalidateCodexLoginStatusCache() {
  loginStatusCache = null;
}

function getLoginStatusCache() {
  return loginStatusCache;
}

function setLoginStatusCache(value) {
  loginStatusCache = value;
  return loginStatusCache;
}

function getActiveCodexLogin() {
  return activeCodexLogin;
}

function setActiveCodexLogin(value) {
  activeCodexLogin = value;
  return activeCodexLogin;
}

module.exports = {
  getActiveCodexLogin,
  getLoginStatusCache,
  invalidateCodexLoginStatusCache,
  setActiveCodexLogin,
  setLoginStatusCache
};
