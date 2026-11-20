// House of Kay characters: the one place every character lives.
// Used by the home page (a taster) and /characters/ (the full list).
//
// New video:      add it to the top of VIDEOS (newest first).
// New character:  add a card to CHARACTER_CARDS (videos: ['<video id>'])
//                 and a matching entry to CHARACTER_BIBLES, same id.
// Link straight to a character with /characters/#<id>, e.g. /characters/#aske

const VIDEOS = [
    { id: 'happy-face', name: 'Happy Face' }
];

const CHARACTER_CARDS = {
    aske: {
        videos: ['happy-face'],
        tag: 'Piskie',
        tagClass: 'bg-plum-600/30 text-plum-300 border-plum-500/30',
        meetName: 'Aske',
        image: '/media/characters/aske/master.jpg',
        imagePosition: 'bg-[center_25%]',
        blurb: 'Pronounced "ASK-uh", the Norwegian and Danish word for ash. When she was a child, a fire took her home and her family and broke her wings as she escaped. After years of grief she decided to take happiness back. Now she walks into the Office of Untimely Endings with an antique shotgun that fires colour powder. Her revenge is joy.'
    },
    gristle: {
        videos: ['happy-face'],
        tag: 'Bogle',
        tagClass: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        meetName: 'Gristle',
        image: '/media/characters/gristle/master.jpg',
        imagePosition: 'bg-center',
        blurb: 'About 175 years old. He was left on a butcher\'s doorstep as a baby and paid for his keep with two fingers of his left hand. He has never known love and scrubs his skin until it\'s red raw. Yet he turns up to work every day immaculate in his dark green suit, and stamps horrific early deaths on babies\' certificates without even looking.'
    },
    art: {
        videos: ['happy-face'],
        tag: 'Young Bogle',
        tagClass: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
        meetName: 'Art',
        image: '/media/characters/art/master.jpg',
        imagePosition: 'bg-center',
        blurb: 'Only 35, which is young for a bogle, and wearing the hand-me-down suit of the uncle who got him the job. Art doesn\'t belong at the Office of Untimely Endings. He feels pangs of guilt he can\'t name, and hovers over the stamp rack looking for the gentlest ending he can find.'
    },
    'bogle-clerks': {
        videos: ['happy-face'],
        tag: 'Office Bogles',
        tagClass: 'bg-slate-600/40 text-slate-300 border-slate-500/40',
        meetName: 'the clerks',
        image: '/media/characters/bogle-clerks/clerk-1-master.jpg',
        imagePosition: 'bg-center',
        blurb: 'The bored, joyless bureaucrats who fill the towering counters of the counting hall. They aren\'t cruel like Gristle or troubled like Art; they stopped caring a long time ago. Clerk 1, the dark slate bogle, is the first one Aske shoots.'
    },
    morrowveils: {
        videos: ['happy-face'],
        tag: 'Watcher Species',
        tagClass: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
        meetName: 'the Morrowveils',
        image: '/media/characters/morrowveils/master.jpg',
        imagePosition: 'bg-center',
        blurb: 'Nosey watcher creatures, part moth and part small furry mammal, with glossy black button eyes, tiny branching antlers and a symbol grown into their skulls. They gather in the fog wherever drama is about to happen, because they feed on it. Over time they change, depending on whether they feast on joy or on tragedy.'
    }
};

const CHARACTER_BIBLES = {
    aske: {
        name: 'Aske',
        species: 'Piskie (Cornish & Devon folklore)',
        pronunciation: 'Pronounced "ASK-uh": Norwegian and Danish for ash, and a nod to Askeladden, the overlooked Ash Lad of Norwegian folk tales who outwits the trolls',
        age: 'Looks early 20s, but is in her 50s (piskies live a long time)',
        backstory: 'When Aske was a child her home burned down. Her whole family died. She was the only one to escape, and her wings were broken getting out. She spent years in misery before deciding to take happiness back. She\'s certain her family\'s deaths were decided at the Office of Untimely Endings. She can\'t prove it, but she\'s right. She hasn\'t come for their files, and she hasn\'t come to kill anyone. Her revenge is joy, and it\'s grown bigger than her own family. Nothing seems to frighten her any more.',
        appearance: 'A small piskie woman whose head barely clears the top of a desk. Her skin is so pale it\'s almost see-through, dewy and freckled, and her face is plain: someone nobody would turn to look at. Her large pale grey-green eyes have wet, red-rimmed lower lids, as if she\'s always about to cry. She wears a yellowed, frayed white t-shirt tucked into a limp, dusty ash-pink tulle skirt. She goes barefoot, and her nails are long and yellowed. Two pairs of battered, see-through dragonfly wings come out through slits in her t-shirt. She doesn\'t look after them any more, and her holster strap is buckled right over them. The shotgun is ornate, almost elvish: carved flowers, dark wood and gold. It fires puffs of colour powder that coat whatever they hit.',
        productionNotes: 'AI image tools kept trying to make Aske pretty, and her eyes kept drifting back to human ones between shots. Keeping her plain took a lot of pushing. For every close-up I give the video model both the first and the last frame, so her eyes stay her own.',
        refs: [
            { src: '/media/characters/aske/master.jpg', title: 'Portrait', note: 'Head and shoulders, front. Every other image of Aske is checked against this one: her eyes, translucent skin, freckles and expression.' },
            { src: '/media/characters/aske/threequarter.jpg', title: 'Three-quarter view', note: 'Turned to show her right ear.' },
            { src: '/media/characters/aske/fullbody-front.jpg', title: 'Full body, front', note: 'Her outfit, the true size of her wings, and the shotgun on her back. Her face was carried over from the portrait by hand.' },
            { src: '/media/characters/aske/fullbody-back.jpg', title: 'Full body, back', note: 'Two pairs of torn dragonfly wings through slits in her t-shirt, and the shotgun on its leather strap.' }
        ]
    },
    gristle: {
        name: 'Gristle',
        species: 'Bogle (Scots & Northern English folklore)',
        pronunciation: 'Named, quietly, after the butcher who raised him',
        age: 'Around 175 (bogles live to about 250)',
        backstory: 'Gristle was left on a butcher\'s doorstep as a baby, and the butcher took two fingers from his left hand as payment for keeping him. He grew up among the butchered remains and didn\'t see daylight until he was 15. Then he escaped and went to bogle school. He has worked at the Office of Untimely Endings ever since he left school at 30. He\'s mean, he smells, and he\'d spit in your tea. He doesn\'t care about himself, yet he makes an effort for work every single day. If you met him you\'d feel fear and pity. The pity lasts until he looks you in the eye and you see there\'s no soul there at all.',
        appearance: 'Short and stocky, with a heavy body, short legs and no neck: his head sits straight down in his hunched shoulders. His huge pointed ears flop over at the tips and sprout coarse hairs. His left eye is gone, the socket scrunched half shut. His right eye is small and chestnut brown, with a goat\'s sideways pupil and no shine at all. His pink skin is rough and large-pored, scrubbed red raw in patches. His teeth are pointed and stained, and his nails are black and picked right down. Even so, he\'s the neatest dresser in the office: a three-piece suit in a green so dark it\'s nearly black, a tall stiff white collar, polished boots, and a cravat embroidered with the Office\'s OUE monogram.',
        productionNotes: 'Ask an AI for a "goblin" and you get a short green fantasy goblin. Mention pigs and his pink skin and big ears turn him into a pig-man. So I built Gristle by describing his shape, never by naming what he looks like. Video models also grow missing fingers back, so his maimed hand only appears in one close-up made just for it.',
        refs: [
            { src: '/media/characters/gristle/master.jpg', title: 'Portrait', note: 'Head and shoulders, front. His goat-pupil eye, the squinted socket and the OUE monogram were all finished by hand.' },
            { src: '/media/characters/gristle/threequarter.jpg', title: 'Three-quarter view', note: 'His skin, drooping ears and dead eye from another angle.' },
            { src: '/media/carousel/gristle-full-body.png', title: 'Full body, front', note: 'Shows his stocky proportions, immaculate dark green three piece suit, four fingered hands and polished boots.' },
            { src: '/media/characters/gristle/hand-right.jpg', title: 'Right hand', note: 'A bogle hand: a thumb and three thick, blunt fingers joined near the base, with black nails picked to the quick.' },
            { src: '/media/characters/gristle/hand-left-maimed.jpg', title: 'Left hand', note: 'Made for a single close-up. The index finger is gone at the knuckle and the little finger at the middle joint, both neatly healed.' }
        ]
    },
    art: {
        name: 'Art',
        species: 'Bogle (Scots & Northern English folklore)',
        pronunciation: 'The newest clerk at the Office of Untimely Endings',
        age: '35 (barely grown up, for a bogle)',
        backstory: 'Art was never much good at anything. When he left school his uncle found him a job at the Office, and a year later he still doesn\'t really know what he\'s doing. He\'s slow, and he spends far too long choosing stamps. A bogle shouldn\'t feel bad about the deaths he hands out, but Art sometimes feels a pang of something he can\'t name. The others slam down the worst endings without a glance; Art puts DECAPITATED back on the rack and reaches for something gentler. One look at him and you know he\'s in the wrong place, maybe even the wrong species. He just doesn\'t know it yet.',
        appearance: 'Taller and slimmer than Gristle. Plain, a little ugly, a little sweet, and always looking worried. Like all bogles he has no neck. He has a long jaw and a pointed chin, a nose that juts out and turns up, and thick, floppy dark chestnut hair. His large wet blue eyes have goat pupils, under eyebrows knotted with concern. His suit is his uncle\'s, a size too big, with a small hole in the lapel and another in one knee. His cravat hangs loose and untied, and he wears a plain gold ring on his left hand. As the newest clerk he was issued the newer cravat, so his OUE monogram is bigger than everyone else\'s.',
        productionNotes: 'Art is built from Gristle, but whenever I gave the AI Gristle\'s whole portrait to work from, it copied his old, angry face. What worked was showing it one part at a time, just the ears or just the uniform, making one change per edit, and then putting Art\'s own face back on by hand.',
        refs: [
            { src: '/media/characters/art/master.jpg', title: 'Portrait', note: 'Worried blue goat-pupil eyes, an upturned nose and the newer, larger OUE monogram.' },
            { src: '/media/characters/art/threequarter.jpg', title: 'Three-quarter view', note: 'Made in Gemini and finished by hand: goat pupils, colour matching and the monogram.' },
            { src: '/media/characters/art/fullbody-front.jpg', title: 'Full body, front', note: 'His uncle\'s oversized suit, the small holes in the lapel and knee, his gold ring and horn nails.' },
            { src: '/media/characters/art/hand-right.jpg', title: 'Right hand', note: 'The same bogle shape as Gristle\'s, but with younger, softer skin, pale horn nails, and a blazer sleeve that\'s too long for him.' }
        ]
    },
    'bogle-clerks': {
        name: 'The Bogle clerks',
        species: 'Bogles (Office bureaucrats)',
        pronunciation: 'Clerk 1, with Clerks 2 and 3 in the background',
        age: 'Middle-aged to old (120 to 190 years)',
        backstory: 'The Office of Untimely Endings runs on bogles like these. They aren\'t cruel like Gristle or conflicted like Art; they simply stopped caring long ago. Clerk 1 is the dark slate bogle whose warty hand slams BURNT onto baby Thrum Drifts\' certificate. He\'s also the first to peer over his desk when Aske kicks it.',
        appearance: 'They share Gristle\'s and Art\'s bogle traits: no neck, big pointed ears, goat pupils, near-black green suits and the OUE monogram on their cravats. Their four-fingered hands are huge, each one longer than an A5 page is wide. Their skin can be any shade. Clerk 1 is a dark purplish slate, dry and leathery, with two smooth warts. Clerk 2 is a creased pinky grey, with his chin sunk inside a tall collar. Clerk 3 is a near-black charcoal brown, with long hanging ears.',
        productionNotes: 'Every AI model I tried gave the clerks five human fingers the moment they gripped a stamp. In the end I photographed my own hand with the little finger folded away and turned it into a flat grey clay shape. Then I painted bogle skin over it by hand and let Gemini do one final pass. That time it kept four digits.',
        refs: [
            { src: '/media/characters/bogle-clerks/clerk-1-master.jpg', title: 'Clerk 1 — Portrait', note: 'The clerk Aske shoots first: dark slate leathery skin, two smooth warts and squinting goat-slot eyes.' },
            { src: '/media/characters/bogle-clerks/clerk-2-background.jpg', title: 'Clerk 2 — Background clerk', note: 'Pinky grey creased skin, small pointed hairy ears, stained pointed teeth and chin sunk inside a tall white collar.' },
            { src: '/media/characters/bogle-clerks/clerk-3-background.jpg', title: 'Clerk 3 — Background clerk', note: 'Dark charcoal brown skin, long narrow hanging ears, pointed chin and sparse comb over.' },
            { src: '/media/characters/bogle-clerks/hand-ref1-back.jpg', title: 'Clerk hand — Back of the hand', note: 'The hand all the clerks share: Gristle\'s four-digit shape in dark slate, with horn nails and big warty knuckles.' },
            { src: '/media/characters/bogle-clerks/hand-ref2-flat-on-page.jpg', title: 'Clerk hand — On the page', note: 'Lamp-lit from above on an A5 birth certificate, to show how big a bogle hand is (about 23 cm long).' },
            { src: '/media/characters/bogle-clerks/hand-ref3-grip-stamp.jpg', title: 'Clerk hand — Gripping the stamp', note: 'Made from a photo of my own hand, turned into a grey clay pose guide so Gemini would keep four digits around the bone-handled stamp.' }
        ]
    },
    morrowveils: {
        name: 'Morrowveils',
        species: 'Watcher creatures (Moth & small mammal hybrid)',
        pronunciation: 'Singular: Morrowveil · Not one character but a whole species, no two alike',
        age: 'Varies. Their ears never stop growing, and droop more with age.',
        backstory: 'Morrowveils roam the fog around the street where the Office of Untimely Endings stands. They go wherever drama is about to happen, because they feed on it, good or bad. The more of one kind they see, the more they crave it. Those that feast on celebrations stay soft and friendly. Those that feed on tragedy grow hunched and snarling, with talon-like claws, and some have caused disasters just to watch. Others make good things happen for the same reason. You can rarely tell which is which at first glance.',
        appearance: 'Anywhere from the size of a blackbird to the size of a cat, they sit upright and very still. Each has a flat, fuzzy moth face with no nose or muzzle, and wide-set solid black eyes under a fold of furred skin. Leaf-shaped ears stick out sideways with fluffy tips, between two small branching antlers, and an intricate sigil is grown into the forehead like a brand. Two pairs of dusty, powdery moth wings carry dark eye-spots. Like cats, they come in every colour and pattern. The one pictured is the master, made so you can\'t tell whether it\'s good or bad.',
        productionNotes: 'Putting "rabbit" or "hare" in a prompt instantly turned the face into a cute plush bunny with a pink nose. The look only held once I described a flat, fuzzy moth face with no muzzle. When the AI still slipped in a little cat nose, I removed it by hand.',
        refs: [
            { src: '/media/characters/morrowveils/master.jpg', title: 'The master Morrowveil', note: 'Perched in a foggy back street with its wings spread, showing the eye-spots, small antlers and the sigil on its forehead.' }
        ]
    }
};

function videoNames(id) {
    const card = CHARACTER_CARDS[id];
    return card.videos.map(v => (VIDEOS.find(x => x.id === v) || { name: v }).name).join(' · ');
}

// Characters from the newest video, up to `limit` (home page taster).
function latestCharacterIds(limit) {
    const latest = VIDEOS[0].id;
    return Object.keys(CHARACTER_CARDS).filter(id => CHARACTER_CARDS[id].videos.includes(latest)).slice(0, limit);
}

function characterCardHtml(id) {
    const c = CHARACTER_CARDS[id];
    const b = CHARACTER_BIBLES[id];
    const n = b.refs.length;
    return `
        <div onclick="openCharacterBible('${id}')" onkeydown="if(event.key==='Enter')openCharacterBible('${id}')" role="button" tabindex="0" data-video="${c.videos.join(' ')}" class="character-card group cursor-pointer p-6 sm:p-8 rounded-2xl bg-charcoal-800 border border-charcoal-700 hover:border-plum-500/60 transition flex flex-col sm:flex-row gap-6 items-center text-center sm:text-left">
            <div class="w-36 h-44 rounded-xl bg-cover ${c.imagePosition} shrink-0 border border-plum-500/40 shadow-lg group-hover:scale-[1.02] transition" style="background-image: url('${c.image}');"></div>
            <div class="space-y-3">
                <div class="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                    <h3 class="gothic-heading text-2xl font-bold text-white group-hover:text-plum-300 transition">${b.name}</h3>
                    <span class="text-xs font-mono px-2.5 py-0.5 rounded-full border ${c.tagClass}">${c.tag} · ${videoNames(id)}</span>
                </div>
                <p class="text-xs sm:text-sm text-slate-300 leading-relaxed">${c.blurb}</p>
                <span class="inline-flex items-center gap-1.5 text-xs text-plum-400 font-semibold group-hover:text-plum-300">
                    Meet ${c.meetName} · ${n} image${n === 1 ? '' : 's'} <i class="fa-solid fa-arrow-right text-[10px]"></i>
                </span>
            </div>
        </div>`;
}

function renderCharacterCards(container, ids) {
    container.innerHTML = ids.map(characterCardHtml).join('');
}

// Video filter pills (All + one per video that has characters)
function renderVideoPills(container) {
    const videos = VIDEOS.filter(v => Object.values(CHARACTER_CARDS).some(c => c.videos.includes(v.id)));
    const pill = (id, label) => `<button onclick="filterCharacters('${id}')" class="char-pill px-4 py-1.5 rounded-full text-xs font-medium border transition" data-video="${id}">${label}</button>`;
    container.innerHTML = pill('all', 'All') + videos.map(v => pill(v.id, v.name)).join('');
    filterCharacters('all');
}

function filterCharacters(video) {
    document.querySelectorAll('.char-pill').forEach(btn => {
        const on = btn.getAttribute('data-video') === video;
        btn.classList.toggle('bg-plum-600', on);
        btn.classList.toggle('text-white', on);
        btn.classList.toggle('border-plum-500', on);
        btn.classList.toggle('text-slate-300', !on);
        btn.classList.toggle('border-charcoal-600', !on);
        btn.classList.toggle('hover:text-white', !on);
    });
    document.querySelectorAll('.character-card').forEach(card => {
        const show = video === 'all' || card.getAttribute('data-video').split(' ').includes(video);
        card.style.display = show ? '' : 'none';
    });
}

// Full-screen character page (modal)
function ensureCharacterModal() {
    if (document.getElementById('character-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'character-modal';
    modal.className = 'fixed inset-0 z-[100] hidden bg-charcoal-900/95 backdrop-blur-xl overflow-y-auto';
    modal.innerHTML = `
        <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
            <div class="flex items-center justify-between pb-6 mb-8 border-b border-charcoal-700">
                <button onclick="closeCharacterBible()" class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-charcoal-800 border border-charcoal-600 text-slate-200 hover:bg-plum-600 hover:text-white hover:border-plum-500 transition text-sm font-medium">
                    <i class="fa-solid fa-arrow-left text-xs"></i> Back to the characters
                </button>
                <button onclick="closeCharacterBible()" class="w-10 h-10 rounded-full bg-charcoal-800 border border-charcoal-600 text-slate-300 hover:text-white flex items-center justify-center" aria-label="Close">
                    <i class="fa-solid fa-xmark text-lg"></i>
                </button>
            </div>
            <div id="character-modal-body" class="space-y-10"></div>
        </div>`;
    document.body.appendChild(modal);
}

function openCharacterBible(id) {
    const char = CHARACTER_BIBLES[id];
    if (!char) return;
    ensureCharacterModal();
    const modal = document.getElementById('character-modal');
    const body = document.getElementById('character-modal-body');

        const refsHtml = char.refs.map(ref => `
            <div class="rounded-2xl bg-charcoal-800 border border-charcoal-700 overflow-hidden flex flex-col">
                <div class="block bg-charcoal-900 overflow-hidden">
                    <img src="${ref.src}" alt="${ref.title}" class="w-full h-80 object-contain bg-charcoal-900">
                </div>
                <div class="p-4 space-y-1.5 flex-grow">
                    <h4 class="gothic-heading text-base font-bold text-white">${ref.title}</h4>
                    <p class="text-xs text-slate-300 leading-relaxed">${ref.note}</p>
                </div>
            </div>
        `).join('');

        body.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                <div class="rounded-2xl overflow-hidden border border-plum-500/40 bg-charcoal-800 shadow-2xl">
                    <img src="${char.refs[0].src}" alt="${char.name}" class="w-full h-auto object-cover">
                </div>
                <div class="lg:col-span-2 space-y-6">
                    <div class="space-y-2">
                        <div class="flex flex-wrap items-center gap-3">
                            <span class="text-xs font-mono px-3 py-1 rounded-full bg-plum-600/30 text-plum-300 border border-plum-500/40">${char.species}</span>
                            <span class="text-xs font-mono px-3 py-1 rounded-full bg-charcoal-800 text-slate-300 border border-charcoal-700">From: ${videoNames(id)}</span>
                        </div>
                        <h2 class="gothic-heading text-3xl sm:text-5xl font-bold text-white pt-1">${char.name}</h2>
                        <p class="text-xs font-mono text-slate-400">${char.pronunciation} · Age: ${char.age}</p>
                    </div>

                    <div class="grid grid-cols-1 gap-4">
                        <div class="p-5 rounded-2xl bg-charcoal-800/80 border border-charcoal-700 space-y-1.5">
                            <h3 class="text-xs font-mono uppercase tracking-widest text-plum-400">Backstory &amp; role</h3>
                            <p class="text-sm text-slate-200 leading-relaxed">${char.backstory}</p>
                        </div>
                        <div class="p-5 rounded-2xl bg-charcoal-800/80 border border-charcoal-700 space-y-1.5">
                            <h3 class="text-xs font-mono uppercase tracking-widest text-plum-400">Appearance</h3>
                            <p class="text-sm text-slate-200 leading-relaxed">${char.appearance}</p>
                        </div>
                        <div class="p-5 rounded-2xl bg-charcoal-800/80 border border-charcoal-700 space-y-1.5">
                            <h3 class="text-xs font-mono uppercase tracking-widest text-amber-300">Behind the scenes</h3>
                            <p class="text-sm text-slate-200 leading-relaxed">${char.productionNotes}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div class="pt-6 border-t border-charcoal-700/80 space-y-6">
                <div class="flex items-center justify-between">
                    <h3 class="gothic-heading text-2xl font-bold text-white">Character studies (${char.refs.length})</h3>
                    <span class="text-xs font-mono text-slate-400">From the making of Happy Face</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    ${refsHtml}
                </div>
            </div>
        `;


    modal.classList.remove('hidden');
    modal.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
}

function closeCharacterBible() {
    const modal = document.getElementById('character-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    if (CHARACTER_BIBLES[location.hash.slice(1)]) history.replaceState(null, '', location.pathname + location.search);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCharacterBible();
});

// Open a character straight from the link, e.g. /characters/#aske
function openCharacterFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (CHARACTER_BIBLES[id]) openCharacterBible(id);
}
window.addEventListener('hashchange', openCharacterFromHash);
document.addEventListener('DOMContentLoaded', openCharacterFromHash);
