// Facebook profile extractor - extracts structured profile data
(function() {
    try {
        var data = {};

        // Name from h1 or page title
        var nameEl = document.querySelector('h1');
        data.name = nameEl ? nameEl.innerText.trim() : document.title.split(' | ')[0].split(' - ')[0].trim();

        // Avatar - profile photo
        var avatarEl = document.querySelector('image[style*="border-radius"]') ||
                       document.querySelector('svg[aria-label] image') ||
                       document.querySelector('[data-imgperflogname="profileCoverPhoto"] img');
        data.avatar_url = avatarEl ? (avatarEl.href ? avatarEl.href.baseVal : avatarEl.src) : null;

        // Bio/intro
        var introItems = document.querySelectorAll('[data-pagelet="ProfileTilesFeed_0"] span, [data-pagelet="above_fold_payload"] ul li span');
        var bioTexts = [];
        introItems.forEach(function(el) {
            var text = el.innerText.trim();
            if (text && text.length > 3 && text.length < 500) {
                bioTexts.push(text);
            }
        });
        data.bio = bioTexts.length > 0 ? bioTexts.join('\n') : null;

        // Location (from intro section)
        data.location = null;
        data.headline = null;

        // No structured work history or education easily available
        data.work_history = [];
        data.education = [];

        if (typeof window.__eggDeliverProfile === 'function') {
            window.__eggDeliverProfile(data);
        } else if (window.__TAURI_INTERNALS__ && window.__PROFILE_ENTITY_ID__) {
            window.__TAURI_INTERNALS__.invoke('receive_profile_extraction', {
                entityId: window.__PROFILE_ENTITY_ID__,
                data: JSON.stringify(data)
            });
        }
    } catch(e) {
        console.error('Facebook profile extraction failed:', e);
    }
})();
