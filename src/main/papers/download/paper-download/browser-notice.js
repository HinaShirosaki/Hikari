'use strict';

const PAPER_DOWNLOAD_NOTICE_ID = 'hikari-paper-download-notice';
const PAPER_DOWNLOAD_NOTICE_HEADING = 'Download this paper';
const PAPER_DOWNLOAD_NOTICE_MESSAGE = 'Click the Download button on this page. Hikari will save the PDF automatically.';

function buildPaperDownloadNoticeScript() {
  return `(() => {
    const noticeId = ${JSON.stringify(PAPER_DOWNLOAD_NOTICE_ID)};
    const heading = ${JSON.stringify(PAPER_DOWNLOAD_NOTICE_HEADING)};
    const message = ${JSON.stringify(PAPER_DOWNLOAD_NOTICE_MESSAGE)};
    const existing = document.getElementById(noticeId);
    if (existing) {
      return true;
    }
    if (!document.body) {
      return false;
    }

    const host = document.createElement('aside');
    host.id = noticeId;
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-label', heading + '. ' + message);
    Object.assign(host.style, {
      all: 'initial',
      position: 'fixed',
      left: '50%',
      bottom: '1.25rem',
      zIndex: '2147483647',
      width: 'min(30rem, calc(100vw - 2rem))',
      transform: 'translateX(-50%)',
      pointerEvents: 'auto'
    });

    const shadow = host.attachShadow({ mode: 'open' });
    const notice = document.createElement('div');
    Object.assign(notice.style, {
      boxSizing: 'border-box',
      display: 'grid',
      gridTemplateColumns: '2.25rem minmax(0, 1fr) 2rem',
      gap: '0.75rem',
      alignItems: 'center',
      width: '100%',
      padding: '0.875rem 1rem',
      border: '0.0625rem solid rgba(255, 255, 255, 0.26)',
      borderRadius: '0.875rem',
      boxShadow: '0 0.875rem 2.25rem rgba(23, 18, 14, 0.28)',
      background: '#647255',
      color: '#fbf9f4',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '0.9375rem',
      lineHeight: '1.35',
      textAlign: 'left'
    });

    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u2193';
    Object.assign(icon.style, {
      boxSizing: 'border-box',
      display: 'grid',
      placeItems: 'center',
      width: '2.25rem',
      height: '2.25rem',
      borderRadius: '999rem',
      background: 'rgba(251, 249, 244, 0.16)',
      color: '#fbf9f4',
      fontSize: '1.5rem',
      fontWeight: '700',
      lineHeight: '1'
    });

    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = heading;
    Object.assign(title.style, {
      display: 'block',
      marginBottom: '0.125rem',
      color: '#ffffff',
      fontSize: '1rem',
      fontWeight: '700'
    });
    const detail = document.createElement('span');
    detail.textContent = message;
    Object.assign(detail.style, {
      display: 'block',
      color: '#fbf9f4'
    });
    copy.append(title, detail);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = '\u00d7';
    dismiss.setAttribute('aria-label', 'Dismiss download instruction');
    dismiss.setAttribute('title', 'Dismiss');
    Object.assign(dismiss.style, {
      boxSizing: 'border-box',
      display: 'grid',
      placeItems: 'center',
      width: '2rem',
      height: '2rem',
      margin: '0',
      padding: '0',
      border: '0.0625rem solid rgba(255, 255, 255, 0.38)',
      borderRadius: '999rem',
      outline: 'none',
      background: 'transparent',
      color: '#ffffff',
      cursor: 'pointer',
      font: '700 1.25rem/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    });
    dismiss.addEventListener('focus', () => {
      dismiss.style.boxShadow = '0 0 0 0.1875rem rgba(255, 255, 255, 0.58)';
    });
    dismiss.addEventListener('blur', () => {
      dismiss.style.boxShadow = 'none';
    });
    dismiss.addEventListener('click', () => host.remove());

    notice.append(icon, copy, dismiss);
    shadow.append(notice);
    document.body.append(host);
    return true;
  })()`;
}

function showPaperDownloadNotice(webContents) {
  if (!webContents || typeof webContents.executeJavaScript !== 'function' || webContents.isDestroyed?.()) {
    return Promise.resolve(false);
  }
  return Promise.resolve(webContents.executeJavaScript(buildPaperDownloadNoticeScript(), true))
    .then((result) => result === true)
    .catch(() => false);
}

function attachPaperDownloadNotice(webContents) {
  if (!webContents) {
    return;
  }
  const showNotice = () => {
    void showPaperDownloadNotice(webContents);
  };
  webContents.on?.('did-finish-load', showNotice);
  showNotice();
}

module.exports = {
  PAPER_DOWNLOAD_NOTICE_HEADING,
  PAPER_DOWNLOAD_NOTICE_ID,
  PAPER_DOWNLOAD_NOTICE_MESSAGE,
  attachPaperDownloadNotice,
  buildPaperDownloadNoticeScript,
  showPaperDownloadNotice
};
