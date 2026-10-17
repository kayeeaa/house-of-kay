/* Builds public/voxie/missions/index.html: a public page listing Voxie's missions by age and kind, so parents (and
   search engines) can see what's in the game. Run after adding or changing missions:
     node scripts/build-voxie-missions-page.mjs
   Only each mission's question is shown, never the answers, choices or hints, so the page can't spoil the game. */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const missionsFolder = join(root, "public/voxie/content/missions");
const outputFolder = join(root, "public/voxie/missions");

const AGE_BANDS = [
  { from: 5, to: 7, heading: "Ages 5 to 7", intro: "Short, gentle missions: noticing feelings, being kind, and puzzles that use pictures and counting." },
  { from: 8, to: 10, heading: "Ages 8 to 10", intro: "Friendships, fairness and trickier puzzles, with more real-world facts." },
  { from: 11, to: 13, heading: "Ages 11 to 13", intro: "Peer pressure, online life and standing up for others, with brain teasers to match." },
];
const KINDS = [
  { kind: "Feel good", about: "Self-care, kindness and mantras: small things to do today." },
  { kind: "What would you do?", about: "Real situations with friends and family. In the game they pick an answer and find out why it works." },
  { kind: "Brain teaser", about: "Surprising facts, checked against reputable sources." },
  { kind: "Puzzle", about: "Logic, number and word puzzles." },
];

const escapeHtml = text => String(text).replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));

const files = readdirSync(missionsFolder).filter(name => name.endsWith(".js")).sort();
const missions = [];
// Each file is "export default { ... }". The project is CommonJS, so load the text as a module rather than by path.
for (const name of files) {
  const source = readFileSync(join(missionsFolder, name), "utf8");
  missions.push((await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default);
}

const total = missions.length;
const bandsHtml = AGE_BANDS.map(band => {
  const forBand = missions.filter(mission => mission.ages && mission.ages[0] <= band.to && mission.ages[1] >= band.from);
  const groups = KINDS.map(({ kind, about }) => {
    const list = forBand.filter(mission => mission.kind === kind).sort((a, b) => (a.difficulty || 0) - (b.difficulty || 0) || a.question.localeCompare(b.question));
    if (!list.length) return "";
    return `        <details class="game-panel mission-group">
          <summary>${escapeHtml(kind)} <span class="mission-count">${list.length}</span></summary>
          <div class="game-body">
            <p class="hint">${escapeHtml(about)}</p>
            <ul class="mission-list">
${list.map(mission => `              <li>${escapeHtml(mission.question)}</li>`).join("\n")}
            </ul>
          </div>
        </details>`;
  }).filter(Boolean).join("\n");
  return `        <h2>${band.heading}</h2>
        <p>${escapeHtml(band.intro)} <strong>${forBand.length} missions</strong> suit this age.</p>
${groups}`;
}).join("\n\n");

const page = `<!DOCTYPE html>
<!-- Made by scripts/build-voxie-missions-page.mjs from public/voxie/content/missions. Don't edit by hand: run the script. -->
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${total} life-skills missions for kids aged 5 to 13 · Voxie</title>
  <meta name="description" content="Every daily mission in Voxie, the free chore and life-skills game for kids: kindness and self-care challenges, real-life 'what would you do?' moments, brain teasers and puzzles, grouped by age." />
  <link rel="canonical" href="https://www.house-of-kay.co.uk/voxie/missions/" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="House of Kay" />
  <meta property="og:title" content="${total} life-skills missions for kids aged 5 to 13 · Voxie" />
  <meta property="og:description" content="Kindness challenges, real-life 'what would you do?' moments, brain teasers and puzzles, grouped by age." />
  <meta property="og:url" content="https://www.house-of-kay.co.uk/voxie/missions/" />
  <meta property="og:image" content="https://www.house-of-kay.co.uk/voxie/share.png" />
  <meta property="og:locale" content="en_GB" />
  <link rel="icon" href="/voxie/favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/voxie/apple-touch-icon.png" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bungee&family=Pixelify+Sans:wght@500;700&family=Atkinson+Hyperlegible:wght@400;700&display=swap">
  <link rel="stylesheet" href="/voxie/styles.css" />
</head>
<body>
  <div class="wrap privacy-wrap">
    <section class="screen home-page">
      <header class="site-top">
        <p class="logo-text-lockup"><span class="text-logo">Voxie</span><span class="logo-byline">by House of Kay</span></p>
        <nav class="site-nav" aria-label="Voxie">
          <a class="btn small ghost" href="/voxie/">← Back to Voxie</a>
        </nav>
      </header>

      <section class="block parents" aria-labelledby="missionsHeading">
        <h1 id="missionsHeading">Missions in Voxie</h1>
        <p>Every day, Voxie gives each child <strong>three missions</strong> picked for their age: a mix of being kind, looking after themselves, thinking through real situations and stretching their brain. There are <strong>${total} missions</strong> for ages 5 to 13, and finishing them earns XP to spend on their pixel buddy.</p>
        <p>Here's every one, so you can see what your child will get. We only show the questions here: the answers stay a surprise in the game.</p>
        <p class="mission-cta"><a class="btn" href="/voxie/">Try Voxie free</a></p>

${bandsHtml}

        <h2>Made with care</h2>
        <p>Every mission was written to a shared style guide and checked by someone other than its writer: facts against reputable sources, puzzles solved from scratch, and every "What would you do?" and "Feel good" mission for tone, safety and age. No mission is aimed at boys or girls: every one is for every child of the right age.</p>
        <p class="mission-cta"><a class="btn" href="/voxie/">Make a free grown-up account</a></p>
      </section>

      <footer class="site-footer"><span class="text-logo small">Voxie</span><span>Made by House of Kay</span><a href="/voxie/privacy/">Privacy</a></footer>
    </section>
  </div>
</body>
</html>
`;

mkdirSync(outputFolder, { recursive: true });
writeFileSync(join(outputFolder, "index.html"), page);
console.log(`Wrote public/voxie/missions/index.html: ${total} missions`);
