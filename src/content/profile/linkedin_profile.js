// LinkedIn profile extractor — text-based parsing
// LinkedIn uses obfuscated CSS classes with no semantic IDs,
// so we parse from section text content instead of selectors.
(function() {
    function scrollDown(cb) {
        // LinkedIn scrolls on the window, and sections below the fold
        // (Education sits under Experience) lazy-load only once scrolled into
        // view. Drive the window to the bottom until the page height stops
        // growing — that means all lazy sections have rendered — then return
        // to the top before extracting.
        var lastHeight = 0, stable = 0, steps = 0;
        function step() {
            window.scrollTo(0, document.documentElement.scrollHeight);
            steps++;
            var h = document.documentElement.scrollHeight;
            if (h === lastHeight) { stable++; } else { stable = 0; }
            lastHeight = h;
            if (stable < 2 && steps < 25) {
                setTimeout(step, 600);
            } else {
                window.scrollTo(0, 0);
                setTimeout(cb, 1200);
            }
        }
        step();
    }

    function doExtract() {
        try {
            var data = {};

            // --- Name from page title ---
            var title = document.title || '';
            // "Dan Bode | LinkedIn" → "Dan Bode"
            data.name = title.replace(/\s*[|–-]\s*LinkedIn.*$/i, '').trim() || null;

            // --- Avatar: find the large profile image inside <main> ---
            // Must search inside main to skip the logged-in user's nav bar avatar
            data.avatar_url = null;
            var mainEl = document.querySelector('main');
            if (mainEl) {
                var imgs = mainEl.querySelectorAll('img');
                for (var i = 0; i < Math.min(imgs.length, 30); i++) {
                    var img = imgs[i];
                    if (img.src && img.src.includes('licdn.com') &&
                        img.src.includes('profile-displayphoto') &&
                        (img.src.includes('_400_400') || img.src.includes('_800_800') || img.width >= 100) &&
                        !img.src.includes('ghost') && !img.src.includes('default')) {
                        data.avatar_url = img.src;
                        break;
                    }
                }
            }

            // --- Parse sections by text content ---
            var sections = document.querySelectorAll('section');
            var profileCardText = '';
            var aboutText = '';
            var experienceText = '';
            var experienceSection = null;
            var educationText = '';

            sections.forEach(function(section) {
                var text = section.innerText || '';
                var trimmed = text.trim();
                var firstLine = trimmed.split('\n')[0].trim();

                // The profile card section contains the person's name
                if (data.name && trimmed.includes(data.name) && trimmed.includes('Message') && !profileCardText) {
                    profileCardText = trimmed;
                }
                // About section
                if (firstLine === 'About' || trimmed.startsWith('About\n')) {
                    aboutText = trimmed;
                }
                // Experience section
                if (firstLine === 'Experience' || trimmed.startsWith('Experience\n')) {
                    experienceText = trimmed;
                    experienceSection = section;
                }
                // Education section
                if (firstLine === 'Education' || trimmed.startsWith('Education\n')) {
                    educationText = trimmed;
                }
            });

            // --- Headline + Location from profile card ---
            data.headline = null;
            data.location = null;
            if (profileCardText) {
                var lines = profileCardText.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
                // Pattern: Name, then "· 1st" or "· 2nd" etc., then headline, then location
                // Find the headline: appears after name, before location
                for (var i = 0; i < lines.length; i++) {
                    if (lines[i] === data.name) {
                        // Look ahead for headline (skip "· 1st" etc.)
                        for (var j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                            var line = lines[j];
                            if (line.match(/^·\s*\d/) || line === 'Message' || line === 'More') continue;
                            if (line.length > 10 && !line.includes('connections') && !line.includes('Contact info')) {
                                // Check if it looks like a location (City, State pattern)
                                if (line.match(/,\s*\w+,\s*(United States|Canada|UK|India|Australia)/i) ||
                                    line.match(/,\s*(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)/i)) {
                                    if (!data.headline) data.headline = lines[j - 1] && lines[j - 1].length > 10 ? lines[j - 1] : null;
                                    data.location = line;
                                    break;
                                }
                                if (!data.headline) {
                                    data.headline = line;
                                }
                            }
                        }
                        break;
                    }
                }
            }

            // --- Bio from About section ---
            data.bio = null;
            if (aboutText) {
                var aboutLines = aboutText.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
                // Skip "About" header, get the rest
                var bioLines = [];
                var pastHeader = false;
                for (var i = 0; i < aboutLines.length; i++) {
                    if (!pastHeader) {
                        if (aboutLines[i] === 'About') { pastHeader = true; continue; }
                    } else {
                        // Stop at LinkedIn's "see more" / "show more" UI text
                        if (aboutLines[i] === 'Show more' || aboutLines[i] === '…see more' ||
                            aboutLines[i] === '\u2026 more' || aboutLines[i] === '… more' ||
                            aboutLines[i] === '...more' || aboutLines[i] === '... more' ||
                            aboutLines[i].match(/^[\u2026.]+\s*more$/i)) break;
                        bioLines.push(aboutLines[i]);
                    }
                }
                if (bioLines.length > 0) {
                    data.bio = bioLines.join('\n');
                }
            }

            // --- Work History from Experience section ---
            data.work_history = [];
            if (experienceText) {
                var expLines = experienceText.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
                // Skip "Experience" header
                var startIdx = 0;
                for (var i = 0; i < expLines.length; i++) {
                    if (expLines[i] === 'Experience') { startIdx = i + 1; break; }
                }

                console.log('[Egg] Experience lines (' + (expLines.length - startIdx) + '):', expLines.slice(startIdx).join(' | '));

                // Helper to classify line types
                function isDateLine(l) {
                    // "Mon YYYY - Mon YYYY" or "Mon YYYY - Present" or "YYYY-YYYY" or "YYYY - YYYY"
                    return l.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s*[-–]\s*(Present|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/i) ||
                           l.match(/^\d{4}\s*[-–]\s*(\d{4}|Present)/i);
                }
                function isCompanyLine(l) {
                    // "Company · Employment Type" but NOT "Full-time · 6 yrs" (employment type + duration)
                    if (!l.includes(' · ')) return false;
                    if (isDateLine(l)) return false;
                    // If it starts with an employment type, it's NOT a company line
                    if (l.match(/^(Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Seasonal|Apprenticeship)\s*·/i)) return false;
                    return true;
                }
                function isDurationLine(l) {
                    return !!l.match(/^\d+\s*(yr|mos|mo)\b/i);
                }
                function isDurationWithType(l) {
                    // "Full-time · 6 yrs 1 mo" — employment type + total duration (grouped header)
                    return !!l.match(/^(Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Seasonal|Apprenticeship)\s*·\s*\d+/i);
                }
                function isLocationLine(l) {
                    return !!(l.match(/·\s*(Remote|On-site|Hybrid)/i) ||
                        l === 'Hybrid' || l === 'Remote' || l === 'On-site' ||
                        (l.match(/,/) && l.match(/(United States|Remote|On-site|Hybrid|Canada|UK|India|Area|Metropolitan)/i)));
                }
                function isSkipLine(l) {
                    return l === 'Show all' || l.match(/^Show \d+/) || l === 'Show more' ||
                           l.match(/^\d+ experience/i) || l.match(/^Show all \d+/) ||
                           l === '…' || l === 'more' || l === '\u2026' ||
                           l.match(/and \+\d+ skills?$/i) || l.match(/^\+\d+ skill/i);
                }
                function isEmploymentType(l) {
                    return !!l.match(/^(Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Seasonal|Apprenticeship)$/i);
                }

                function saveEntry(entry) {
                    if (entry && (entry.company || entry.title)) {
                        if (!entry.company) entry.company = entry.title;
                        data.work_history.push(entry);
                        console.log('[Egg] Saved job: ' + (entry.title || '?') + ' @ ' + (entry.company || '?'));
                    }
                }

                // Two-pass approach:
                // Pass 1: identify grouped companies (company name followed by total duration, then sub-roles)
                // Pass 2: parse each entry
                //
                // LinkedIn Experience text patterns:
                //   Single role:  Title | Company · Type | Date · Duration | Location
                //   Grouped:      Company | Total Duration | Title1 | Date1 · Duration | Location | Title2 | Date2 · Duration | Location
                //
                // Key insight: in grouped format, the company line does NOT have " · " — it's just the company name.
                // The next line is a total duration like "3 yrs 2 mos". Then sub-roles follow.

                var currentEntry = null;
                var groupCompany = null; // Set when we detect a grouped company header

                for (var i = startIdx; i < expLines.length; i++) {
                    var line = expLines[i];
                    if (isSkipLine(line)) continue;

                    var dateMatch = isDateLine(line);
                    var companyMatch = isCompanyLine(line);
                    var durationMatch = isDurationLine(line);
                    var locationMatch = isLocationLine(line);
                    var employmentMatch = isEmploymentType(line);

                    // Detect grouped company header:
                    // Pattern A: "Company" + "3 yrs 2 mos" (pure duration on next line)
                    // Pattern B: "Company" + "Full-time · 6 yrs 1 mo" (employment type + duration)
                    // Pattern C: "Company" + "Full-time · 6 yrs 1 mo" + location
                    var nextLine = i + 1 < expLines.length ? expLines[i + 1] : '';
                    if (!dateMatch && !companyMatch && !durationMatch && !locationMatch && !employmentMatch &&
                        line.length < 80 && (isDurationLine(nextLine) || isDurationWithType(nextLine))) {
                        // This line is a company name, next line is total duration → grouped roles
                        saveEntry(currentEntry);
                        currentEntry = null;
                        groupCompany = line;
                        i++; // skip the duration/type line
                        // Also skip a location line if it immediately follows the duration
                        if (i + 1 < expLines.length && isLocationLine(expLines[i + 1])) {
                            i++;
                        }
                        console.log('[Egg] Grouped company detected: ' + groupCompany);
                        continue;
                    }

                    if (companyMatch) {
                        // "Company · Full-time" — this starts a new single entry
                        // Save previous entry first
                        saveEntry(currentEntry);
                        currentEntry = {};
                        var parts = line.split(' · ');
                        currentEntry.company = parts[0];
                        // Title is on the previous line (if it's not a date, company, etc.)
                        if (i > startIdx) {
                            var prev = expLines[i - 1];
                            if (prev && !isDateLine(prev) && !isCompanyLine(prev) && !isDurationLine(prev) &&
                                !isLocationLine(prev) && !isSkipLine(prev) && !isEmploymentType(prev)) {
                                currentEntry.title = prev;
                            }
                        }
                        groupCompany = null; // clear grouped context
                    } else if (dateMatch) {
                        // If current entry already has dates, save it and start fresh
                        if (currentEntry && currentEntry.start_date) {
                            saveEntry(currentEntry);
                            currentEntry = null;
                        }
                        if (!currentEntry) {
                            // Date without a current entry — start one and look back for title/company
                            currentEntry = {};
                            // Collect lookback candidates (skip noise lines)
                            var lookback = [];
                            for (var back = i - 1; back >= startIdx && lookback.length < 4; back--) {
                                var prev = expLines[back];
                                if (isSkipLine(prev) || isDurationLine(prev) || isEmploymentType(prev) || isDurationWithType(prev)) continue;
                                if (isDateLine(prev) || isLocationLine(prev)) break; // hit previous entry boundary
                                if (prev.length > 80) break; // hit a description line from previous entry
                                lookback.push(prev);
                            }
                            // lookback[0] = closest non-noise line above date, lookback[1] = one above that, etc.
                            if (lookback.length >= 2 && isCompanyLine(lookback[0])) {
                                // Pattern: Title | Company · Type | Date
                                currentEntry.company = lookback[0].split(' · ')[0];
                                currentEntry.title = lookback[1];
                                groupCompany = null;
                            } else if (lookback.length >= 2 && !isCompanyLine(lookback[0]) && !isCompanyLine(lookback[1])) {
                                // Two plain lines before date. Could be:
                                //   a) Grouped sub-role: Title | (noise) | Date — company from group
                                //   b) New single role: Title | CompanyName | Date
                                // Heuristic: if in a group AND lb[0] is very short or looks like a title
                                // (contains comma like "VP, Something"), treat as sub-role title.
                                // Otherwise, lb[0] is a new company name.
                                if (groupCompany && lookback.length === 1) {
                                    // Only one lookback line — must be a sub-role title
                                    currentEntry.title = lookback[0];
                                    currentEntry.company = groupCompany;
                                } else {
                                    // Two+ lookback lines: lb[0] = company, lb[1] = title (new company)
                                    currentEntry.company = lookback[0];
                                    currentEntry.title = lookback[1];
                                    groupCompany = null; // left the grouped company
                                }
                            } else if (lookback.length >= 1) {
                                currentEntry.title = lookback[0];
                                if (groupCompany) {
                                    currentEntry.company = groupCompany;
                                }
                            }
                        }
                        var dateStr = line.split(' · ')[0];
                        var dateParts = dateStr.split(/\s*[-–]\s*/);
                        currentEntry.start_date = dateParts[0] || null;
                        currentEntry.end_date = dateParts.length > 1 ? dateParts[1] : null;
                        currentEntry.is_current = line.toLowerCase().includes('present');
                        if (groupCompany && !currentEntry.company) {
                            currentEntry.company = groupCompany;
                        }
                    } else if (locationMatch && currentEntry) {
                        currentEntry.location = line.split(' · ')[0];
                        // Location is typically the last field — save the entry
                        saveEntry(currentEntry);
                        currentEntry = null;
                    } else if (durationMatch) {
                        // Duration-only line (e.g. "2 yrs 3 mos") — skip
                        continue;
                    } else if (employmentMatch) {
                        // Employment type on its own line — skip
                        continue;
                    } else if (currentEntry && currentEntry.start_date && line.length > 30) {
                        // Description text
                        currentEntry.description = line;
                        saveEntry(currentEntry);
                        currentEntry = null;
                    }
                }
                // Save last entry
                saveEntry(currentEntry);
            }

            // --- Extract company LinkedIn URLs from Experience section DOM ---
            if (experienceSection && data.work_history.length > 0) {
                var companyLinks = experienceSection.querySelectorAll('a[href*="/company/"]');
                var urlMap = {}; // company name -> linkedin URL
                for (var i = 0; i < companyLinks.length; i++) {
                    var href = companyLinks[i].href || '';
                    // Extract clean company URL: https://www.linkedin.com/company/cisco
                    var match = href.match(/(https?:\/\/[^/]*linkedin\.com\/company\/[^/?#]+)/);
                    if (match) {
                        // Get the visible text near the link as the company name
                        var linkText = (companyLinks[i].innerText || '').trim();
                        if (linkText && linkText.length > 1 && linkText.length < 100) {
                            urlMap[linkText.toLowerCase()] = match[1];
                        }
                    }
                }
                // Match URLs to work history entries by company name
                for (var i = 0; i < data.work_history.length; i++) {
                    var entry = data.work_history[i];
                    if (entry.company) {
                        var key = entry.company.toLowerCase();
                        if (urlMap[key]) {
                            entry.company_linkedin_url = urlMap[key];
                        } else {
                            // Try partial match
                            for (var name in urlMap) {
                                if (key.includes(name) || name.includes(key)) {
                                    entry.company_linkedin_url = urlMap[name];
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // --- Education from Education section ---
            data.education = [];
            if (educationText) {
                var eduLines = educationText.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
                var startIdx = 0;
                for (var i = 0; i < eduLines.length; i++) {
                    if (eduLines[i] === 'Education') { startIdx = i + 1; break; }
                }
                // Education entries: School → Degree, Field → Date range
                var currentEdu = null;
                for (var i = startIdx; i < eduLines.length; i++) {
                    var line = eduLines[i];
                    if (line === 'Show all' || line === 'Show more') continue;

                    var isDateRange = line.match(/^\d{4}\s*[-–]\s*\d{4}/) || line.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\s*\d{4}\s*[-–]/i);

                    if (!currentEdu) {
                        currentEdu = { school: line };
                    } else if (isDateRange) {
                        var parts = line.split(/\s*[-–]\s*/);
                        currentEdu.start_date = parts[0] || null;
                        currentEdu.end_date = parts.length > 1 ? parts[1] : null;
                        // Save
                        data.education.push(currentEdu);
                        currentEdu = null;
                    } else if (!currentEdu.degree) {
                        var degreeParts = line.split(', ');
                        currentEdu.degree = degreeParts[0] || null;
                        currentEdu.field_of_study = degreeParts.length > 1 ? degreeParts.slice(1).join(', ') : null;
                    } else {
                        // New school — save current and start new
                        data.education.push(currentEdu);
                        currentEdu = { school: line };
                    }
                }
                if (currentEdu && currentEdu.school) {
                    data.education.push(currentEdu);
                }
            }

            // Diagnostic: what section headings did we see, and how tall did the
            // page get? Lets us tell "no education section" from "didn't scroll".
            data._sections = Array.prototype.slice.call(document.querySelectorAll('section'))
                .map(function(s) { return ((s.innerText || '').trim().split('\n')[0] || '').trim(); })
                .filter(function(x) { return x.length > 0 && x.length < 40; });
            data._scrollHeight = document.documentElement.scrollHeight;

            console.log('[Egg] Extracted:',
                'name=' + data.name,
                'headline=' + (data.headline || 'NONE'),
                'location=' + (data.location || 'NONE'),
                'bio=' + (data.bio ? data.bio.substring(0, 50) + '...' : 'NONE'),
                'work=' + data.work_history.length,
                'edu=' + data.education.length
            );

            // Deliver the extracted data. The extension sets
            // window.__eggDeliverProfile (routes to the Gateway); the native
            // browser uses the Tauri command against a pre-created entity.
            // Extraction above is identical for both.
            if (typeof window.__eggDeliverProfile === 'function') {
                window.__eggDeliverProfile(data);
            } else if (window.__TAURI_INTERNALS__ && window.__PROFILE_ENTITY_ID__) {
                window.__TAURI_INTERNALS__.invoke('receive_profile_extraction', {
                    entityId: window.__PROFILE_ENTITY_ID__,
                    data: JSON.stringify(data)
                });
            }
            console.log('[Egg] Profile extraction sent');
        } catch(e) {
            console.error('[Egg] Extraction error:', e);
        }
    }

    scrollDown(doExtract);
})();
