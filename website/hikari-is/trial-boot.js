// This small guard runs independently of the app bundle, so failed startup can
// always report a useful error and offer a retry without replacing the preview.
(function () {
  let ready = false, reported = false;
  function fail() {
    if (ready || reported) return;
    reported = true;
    const message = 'This demo could not start. Reload the demo to try again.';
    const params = new URLSearchParams(window.HikariTrialFrameParams || location.search), model = window.HikariTrialModel;
    const feature = model ? model.resolveFeature(params.get('feature'), params.get('capture') === '1') : params.get('feature') || 'cloning';
    const targetOrigin=model?.messageTargetOrigin(location) || (location.protocol==='file:' || location.origin==='null' ? '*' : location.origin);
    if (parent !== window) parent.postMessage({type:'hikari-trial:error',feature,message},targetOrigin);
    else {
      const show = () => {
        const banner = document.createElement('div');
        banner.className = 'trial-boot-error'; banner.setAttribute('role','alert');
        const text = document.createElement('span'); text.textContent = message;
        const retry = document.createElement('button'); retry.textContent = 'Reload demo';
        retry.addEventListener('click',()=>location.reload());
        banner.append(text,retry); document.body.append(banner);
      };
      if (document.body) show(); else document.addEventListener('DOMContentLoaded',show,{once:true});
    }
  }
  const timeout = setTimeout(fail,15000);
  addEventListener('hikari-trial-ready',()=>{ready=true;clearTimeout(timeout);},{once:true});
  addEventListener('error',event=>{if(event.error || event.target?.tagName==='SCRIPT'){console.error('Trial startup:',event.error?.stack || event.target?.src);fail();}},true);
  addEventListener('unhandledrejection',event=>{console.error('Trial startup:',event.reason?.stack || event.reason);fail();});
})();
