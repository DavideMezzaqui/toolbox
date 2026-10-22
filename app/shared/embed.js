/* Embed: the contract between a Studio mode page and the Studio host.
   A tool page loads ../shared/kit.js and ../shared/embed.js. Opened inside
   Studio its URL carries ?embed=1 (and maybe &mode=...): the page hides its
   own header (body.embed), registers its title, actions and shortcuts with
   the host, and receives files the host routes to it. Opened on its own it
   keeps working exactly as before: every call here is a no-op or falls back
   to the page's own Kit. */
(function(){
  'use strict';
  var qs = new URLSearchParams(location.search);
  var embedded = qs.has('embed');
  function host(){
    try{ return (embedded && window.parent && window.parent !== window && window.parent.Studio) || null; }
    catch(e){ return null; }
  }
  if(embedded) document.documentElement.classList.add('embed');
  document.addEventListener('DOMContentLoaded', function(){ if(embedded) document.body.classList.add('embed'); });

  var Embed = {
    /* true when running inside Studio */
    active: embedded,
    /* the mode asked by the host (?mode=compare), or '' */
    mode: qs.get('mode') || '',
    /* spec = {
         id:        'join' | 'compare' | ...   (the Studio mode id)
         title:     'Join clips',
         actions:   [{id, label, icon, primary, tip, key, disabled, run}],   shown in the host header, in order
         shortcuts: [['Group', [['Key','What it does'], ...]], ...]          merged into the host popover
         accepts:   ['video/*', 'image/*', '.json', ...]                     what this mode can take from the tray
         onReceive: function(files){}                                        files dropped on / sent to this mode
         onShow:    function(){}  onHide: function(){}                       visibility (pause playback when hidden)
       } */
    register: function(spec){
      var h = host();
      if(h && h.register) h.register(window, spec);
      return Embed;
    },
    /* change one action: Embed.action('export', {disabled:true, label:'Exporting...'}) */
    action: function(id, patch){
      var h = host();
      if(h && h.updateAction) h.updateAction(window, id, patch);
    },
    /* status text in the host header (e.g. "3 clips, 0:42"); '' clears it */
    status: function(text){
      var h = host();
      if(h && h.status) h.status(window, text || '');
    },
    /* toasts and dialogs: in the host when embedded, so they sit in one place */
    toast: function(msg, opts){
      var h = host();
      if(h && h.toast) return h.toast(msg, opts);
      if(window.Kit) return Kit.toast(msg, opts);
    },
    dialog: function(spec){
      var h = host();
      if(h && h.dialog) return h.dialog(spec);
      return window.Kit ? Kit.dialog(spec) : Promise.resolve(null);
    },
    confirm: function(text, opts){
      var h = host();
      if(h && h.confirm) return h.confirm(text, opts);
      return window.Kit ? Kit.confirm(text, opts) : Promise.resolve(false);
    },
    prompt: function(title, opts){
      var h = host();
      if(h && h.prompt) return h.prompt(title, opts);
      return window.Kit ? Kit.prompt(title, opts) : Promise.resolve(null);
    },
    /* hand files to another Studio mode ('join', 'sheet', 'flipbook', ...) */
    send: function(modeId, files){
      var h = host();
      if(h && h.send) return h.send(modeId, files);
      return false;
    },
    /* the host's media tray: add files so other modes can pick them up */
    tray: function(files){
      var h = host();
      if(h && h.tray) h.tray(files);
    }
  };
  window.Embed = Embed;
})();
