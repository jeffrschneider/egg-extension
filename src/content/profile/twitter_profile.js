// Twitter/X profile extractor - extracts structured profile data
(function() {
    try {
        var data = {};

        // Name and handle from UserName testid
        var userNameEl = document.querySelector('[data-testid="UserName"]');
        if (userNameEl) {
            var heading = userNameEl.querySelector('span');
            data.name = heading ? heading.innerText.trim() : null;
        }

        // Avatar
        var avatarEl = document.querySelector('[data-testid="UserAvatar"] img');
        data.avatar_url = avatarEl ? avatarEl.src : null;

        // Bio/description
        var bioEl = document.querySelector('[data-testid="UserDescription"]');
        data.bio = bioEl ? bioEl.innerText.trim() : null;

        // Location
        var locationEl = document.querySelector('[data-testid="UserLocation"]');
        data.location = locationEl ? locationEl.innerText.trim() : null;

        // Headline (Twitter doesn't have one, use bio first line as fallback)
        data.headline = null;

        // No work history or education on Twitter
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
        console.error('Twitter profile extraction failed:', e);
    }
})();
