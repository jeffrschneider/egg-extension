// Shared social-profile detector — a JS mirror of detect_social_profile (Rust,
// commands/browser.rs). Exposes:
//   window.__eggSocial.detect(url) -> { platform, kind, username, name } | null
// so the extension and any page-side code identify a profile the same way the
// native browser does.
(function () {
  function slugToName(slug) {
    return slug
      .split('-')
      .filter(Boolean)
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); })
      .join(' ');
  }

  function detect(urlStr) {
    var u;
    try { u = new URL(urlStr); } catch (e) { return null; }
    var host = u.hostname.toLowerCase();
    var path = u.pathname;

    // LinkedIn: /in/{slug} -> person, /company/{slug} -> organization
    if (host.indexOf('linkedin.com') !== -1) {
      var mIn = path.match(/^\/in\/([^\/]+)/);
      if (mIn) return { platform: 'linkedin', kind: 'person', username: mIn[1], name: slugToName(mIn[1]) };
      var mCo = path.match(/^\/company\/([^\/]+)/);
      if (mCo) return { platform: 'linkedin', kind: 'organization', username: mCo[1], name: slugToName(mCo[1]) };
    }

    // Twitter / X: /{username}, excluding reserved routes
    if (host === 'twitter.com' || host === 'x.com' || host === 'www.twitter.com' || host === 'www.x.com') {
      var t = path.replace(/^\//, '').replace(/^@/, '').split('/')[0];
      var reservedT = ['i', 'home', 'explore', 'search', 'settings', 'notifications', 'messages'];
      if (t && reservedT.indexOf(t) === -1) {
        return { platform: 'twitter', kind: 'person', username: t, name: t };
      }
    }

    // Facebook: /pages/{slug} -> organization, else /{username} -> person
    if (host.indexOf('facebook.com') !== -1) {
      var mPage = path.match(/^\/pages\/([^\/]+)/);
      if (mPage) return { platform: 'facebook', kind: 'organization', username: mPage[1], name: slugToName(mPage[1]) };
      var fb = path.replace(/^\//, '').split('/')[0];
      var reservedF = ['login', 'watch', 'marketplace', 'groups', 'events', ''];
      if (reservedF.indexOf(fb) === -1) {
        return { platform: 'facebook', kind: 'person', username: fb, name: fb };
      }
    }

    return null;
  }

  window.__eggSocial = { detect: detect };
})();
