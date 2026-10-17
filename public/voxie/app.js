/* ======================================================================
   app.js  —  screens and game logic. Talks to the backend only through
   dataLayer. Claude Code: do not change markup or styling from here.
   ====================================================================== */
const element = id => document.getElementById(id);
const escapeHtml = text => String(text).replace(/[&<>"]/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[character]));
const ALL_SCREENS = ["screenLoading", "screenLogin", "screenParents", "screenParentHome", "screenSetupName", "screenSetupPet", "screenSetupLook", "screenGame", "screenInventory", "screenHouse", "screenLocations", "screenBuddies", "screenFriends", "screenConfig", "screenShop", "screenGames", "screenSchool"];
const TAB_SCREENS = ["screenGame", "screenInventory", "screenShop", "screenHouse", "screenLocations", "screenBuddies", "screenFriends", "screenConfig", "screenGames", "screenSchool"];
/* Which tab is lit for each screen. House and Locations share Places; Config is opened from Home. */
const TAB_FOR_SCREEN = { screenGame: "home", screenConfig: "home", screenInventory: "inventory", screenShop: "inventory", screenHouse: "places", screenLocations: "places", screenBuddies: "buddies", screenFriends: "friends", screenGames: "games", screenSchool: "school" };
const LOCK_ICON = `<svg class="lock-icon" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><rect x="2" y="0" width="4" height="1"/><rect x="1" y="1" width="1" height="3"/><rect x="6" y="1" width="1" height="3"/><rect x="0" y="3" width="8" height="5"/><rect x="3" y="5" width="2" height="2" fill="var(--sunk)"/></svg>`;

let currentProfile = null;
let setupDraft = null;
let currentProgress = { levelPoints: 0, xp: 0, daysPlayedTotal: 0, daysPlayedDates: [], missionsDoneToday: [] };
let choresDoneToday = [];
let myChores = [];
let myOwnTasksToday = [];
let myScheduledTasks = [];
let scheduledDoneToday = [];
let myItemXp = {};
let myPurchases = [];
let myItemColours = {};     // { itemId: colourId }
let myGotAtLevels = {};     // { itemId: level } for Shop / chance items
let myChance = { wonItemIds: [], swappedAwayItemIds: [], triedItemIds: [], boxesOpenedToday: 0 };
let retryLastFailedAction = null;

function showScreen(screenId) {
  element("itemSheet").hidden = true;
  element("buySheet").hidden = true;
  element("loginSheet").hidden = true;
  element("chanceSheet").hidden = true;
  if (typeof newItemQueue !== "undefined") newItemQueue = [];
  if (typeof stopMissionTimer === "function") stopMissionTimer();
  if (typeof stopPong === "function") stopPong();
  if (typeof stopSnap === "function") stopSnap();
  if (typeof clearPetMessageTimers === "function") { clearPetMessageTimers(); element("petMessage").hidden = true; }
  ALL_SCREENS.forEach(id => element(id).hidden = id !== screenId);
  if (screenId === "screenLoading") drawLoadingBuddy(element("loadingScreenBuddy"));
  if (typeof startAngelAnimation === "function") startAngelAnimation();
  element("tabBar").hidden = !TAB_SCREENS.includes(screenId);
  element("schoolTab").hidden = !featureOn("school");
  document.querySelectorAll(".tab[data-tab]").forEach(tab => tab.dataset.tab === TAB_FOR_SCREEN[screenId] ? tab.setAttribute("aria-current", "page") : tab.removeAttribute("aria-current"));
  // More lights up for the tabs inside it.
  if (element("moreMenu").querySelector(`[data-tab="${TAB_FOR_SCREEN[screenId]}"]`)) element("moreTab").setAttribute("aria-current", "page");
  else element("moreTab").removeAttribute("aria-current");
  closeMoreMenu();
  window.scrollTo(0, 0);
}

/* Button labels use the pixel font, whose digits read badly, so numbers in a label get the chunky number font. */
function setButtonText(button, text) {
  button.innerHTML = escapeHtml(text).replace(/\d+/g, digits => `<span class="num">${digits}</span>`);
}
/* ---------- Logged out by the server (session expired) ----------
   Every dataLayer call goes through this wrapper. If the server says the child isn't logged in any more,
   they go back to the log-in screen with a clear message, instead of an "internet" error that can't be fixed. */
let sessionEnded = false;
Object.keys(dataLayer).forEach(name => {
  const original = dataLayer[name];
  dataLayer[name] = async (...args) => {
    try { return await original.apply(dataLayer, args); }
    catch (error) { if (error.message === "not-signed-in" && name !== "getSignedInProfile") endSession(); throw error; }
  };
});
function endSession() {
  if (sessionEnded) return;
  sessionEnded = true;
  resetSessionState();
  openLogin();
  openLoginSheet("You've been logged out. Log in again to carry on.");
}
/* Clears everything from the last child, so a brother logging in on the same tablet starts fresh. */
function resetSessionState() {
  currentProfile = null;
  missionHelp = {}; openMissionId = null; newItemQueue = []; levelsSeen = {};
  myChance = { wonItemIds: [], swappedAwayItemIds: [], triedItemIds: [], boxesOpenedToday: 0, treasureClaimedThisWeek: false, claimedMilestones: [] };
  myPurchases = []; myItemXp = {}; myItemColours = {}; myGotAtLevels = {}; myBuddies = [];
  myFriendRequests = []; mySentFriendRequests = []; renderFriendsBadge();
  parentChildren = []; parentOpenChildId = null; parentOverview = null;
  inventoryBrowser.mode = houseBrowser.mode = "type"; lastPlacesScreen = "screenHouse";
  ["itemSheet", "buySheet", "chanceSheet", "parentNoticeSheet", "childNoticeSheet"].forEach(id => element(id).hidden = true);
  hideLevelUp(); hideSaveError(); gameLoadedOnDay = null;
}
function showSaveError(message, retryAction) {
  if (sessionEnded) return;
  element("toastMessage").textContent = message;
  retryLastFailedAction = retryAction;
  element("toastRetry").hidden = !retryAction;
  element("toast").hidden = false;
}
function hideSaveError() { element("toast").hidden = true; retryLastFailedAction = null; }
element("toastClose").onclick = hideSaveError;
element("toastRetry").onclick = () => { const action = retryLastFailedAction; hideSaveError(); if (action) action(); };

/* Game names and buddy names. Dashes and underscores are allowed, since a game name starts as the username. */
function validateName(rawName, maxLength = MAX_NAME_LENGTH) {
  const name = rawName.trim();
  if (!name) return { name, error: "Type a name first." };
  if (name.length > maxLength) return { name, error: `That's too long. Use up to ${maxLength} letters or numbers.` };
  if (!/^[\p{L}\p{N} _-]+$/u.test(name)) return { name, error: "Use letters, numbers, spaces and dashes only." };
  return { name, error: "" };
}
const NAME_TAKEN_MESSAGE = "Someone's already got that name. Try adding a number or another word.";
/* Checks a game name isn't taken before saving it. Your own current name always counts as free. */
async function gameNameError(name) {
  if (currentProfile && name.toLowerCase() === (currentProfile.display_name || "").toLowerCase()) return "";
  try { return (await dataLayer.isGameNameAvailable(name)) ? "" : NAME_TAKEN_MESSAGE; }
  catch (error) { return ""; }   // can't check right now: the server checks again when it saves
}
function showFieldError(inputId, errorId, message) {
  element(errorId).textContent = message;
  if (message) element(inputId).setAttribute("aria-invalid", "true"); else element(inputId).removeAttribute("aria-invalid");
}

/* With reset on: days in a row up to today (or up to yesterday, so today isn't "missed" until it's over).
   With reset off: every day ever played counts.
   shieldsPerWeek (Streak shield power): that many missed days in each week (Monday to Sunday) are skipped over
   instead of ending the streak. Shielded days don't add to the streak. */
function calculateStreak(daysPlayedDates, today, resetsOnMiss, shieldsPerWeek = 0) {
  if (!resetsOnMiss) return daysPlayedDates.length;
  const played = new Set(daysPlayedDates), shieldsUsed = {};
  const earliest = [...played].sort()[0];
  let day = played.has(today) ? today : shiftDate(today, -1), streak = 0;
  while (earliest && day >= earliest) {
    if (played.has(day)) { streak++; }
    else {
      const week = weekStartOf(day);
      if ((shieldsUsed[week] || 0) >= shieldsPerWeek) break;
      shieldsUsed[week] = (shieldsUsed[week] || 0) + 1;
    }
    day = shiftDate(day, -1);
  }
  return streak;
}
/* The Monday of the week a date is in (weeks run Monday to Sunday). */
function weekStartOf(isoDate) {
  const weekDay = new Date(isoDate + "T12:00:00Z").getUTCDay();
  return shiftDate(isoDate, -((weekDay + 6) % 7));
}
/* The level of the buddy that's playing (shown on screen, makes the pet bigger at BIGGER_BUDDY_LEVEL). */
function currentLevel() { return calculateLevel(currentProgress.levelPoints); }
function buddyLevel(buddyId) { return calculateLevel((currentProgress.buddyLevelPoints || {})[buddyId] || 0); }
/* Unlocks use the highest level the PLAYING buddy has ever reached, so un-ticking a task never locks things again.
   Each buddy has its own items and unlock order: a new buddy starts again from level 1. */
function unlockedLevel() { return Math.max(currentLevel(), currentProgress.highestLevelReached || 1); }
function rebirthsAvailableNow() { return rebirthsAvailable(myBuddies.map(buddy => buddyLevel(buddy.id))); }
function petTypesNotCollected() { return PET_ORDER.filter(petType => !myBuddies.some(buddy => buddy.petType === petType)); }
function petName() { return currentProfile ? currentProfile.pet_name : "your pet"; }
/* The highest level each buddy has shown a level-up for this visit, so un-ticking and re-ticking doesn't celebrate twice. */
let levelsSeen = {};
function addLevelPoints(points) {
  const buddyId = currentProfile.active_buddy_id, levelBefore = currentLevel(), unlockedBefore = unlockedLevel(), rebirthsBefore = rebirthsAvailableNow();
  if (levelsSeen[buddyId] === undefined) levelsSeen[buddyId] = levelBefore;
  currentProgress.levelPoints += points;
  currentProgress.buddyLevelPoints = { ...currentProgress.buddyLevelPoints, [buddyId]: currentProgress.levelPoints };
  currentProgress.highestLevelReached = Math.max(currentProgress.highestLevelReached || 1, currentLevel());
  const newLevel = currentLevel() > levelsSeen[buddyId];
  if (newLevel) { levelsSeen[buddyId] = currentLevel(); showLevelUp(currentLevel(), unlockedBefore, unlockedLevel(), rebirthsAvailableNow() > rebirthsBefore); }
  if (points > 0) {
    markPlayedToday();
    showPetMessage(taskDoneLine(newLevel ? currentLevel() : null));
  }
}
function markPlayedToday() {
  const today = getTodayInUk();
  if (!currentProgress.daysPlayedDates.includes(today)) { currentProgress.daysPlayedDates = [...currentProgress.daysPlayedDates, today]; currentProgress.daysPlayedTotal++; }
}
/* Ticking adds a point to the buddy that's playing. Unticking reloads progress from the server, because the point
   comes off whichever buddy earned it (which might not be the one playing now). */
async function applyTaskTick(nowDone) {
  if (nowDone) { addLevelPoints(1); return; }
  try { currentProgress = await dataLayer.loadProgressSummary(); } catch (error) { addLevelPoints(-1); }
}
/* Only things not already unlocked by another buddy are listed. */
function showLevelUp(toLevel, unlockedBefore, unlockedAfter, earnedRebirth) {
  const rewards = LEVEL_REWARDS.filter(reward => reward.level > unlockedBefore && reward.level <= unlockedAfter);
  if (earnedRebirth && petTypesNotCollected().length) rewards.unshift({ label: "a rebirth! Pick your next pet in Buddies", kind: "buddy" });
  if (toLevel % MILESTONE_EVERY_LEVELS === 0) rewards.unshift({ label: "a free Mystery box (open it on Home)", kind: "growth" });
  element("levelUpTitle").textContent = `Level ${toLevel}!`;
  element("levelUpText").textContent = rewards.length
    ? `You unlocked ${rewards.map(reward => reward.label.charAt(0).toLowerCase() + reward.label.slice(1)).join(" and ")}.`
    : "Keep going for your next unlock.";
  const firstReward = rewards.find(reward => reward.kind !== "growth");
  element("levelUpGo").hidden = !firstReward;
  element("levelUpGo").dataset.target = !firstReward ? "" : firstReward.kind === "look" || firstReward.kind === "buddy" ? "customise" : firstReward.kind === "location" ? "locations" : firstReward.kind === "house" ? "house" : firstReward.category;
  element("levelUpBanner").hidden = false;
  // Every new item gets its own "New item!" pop-up, one at a time, where they choose Keep it or Take a chance.
  const newItemIds = rewards.filter(reward => reward.itemId && ownsItemNow(reward.itemId)).map(reward => reward.itemId);
  if (newItemIds.length) queueNewItemReveals(newItemIds);
}
function hideLevelUp() { element("levelUpBanner").hidden = true; }
function lookFromProfile(profile) {
  return { displayName: profile.display_name, petType: PET_TYPES[profile.pet_type] ? profile.pet_type : "axolotl", petName: profile.pet_name,
    themeColour: profile.theme_colour, location: profile.location || "home", petLook: { ...DEFAULT_PET_LOOK, ...(profile.pet_look || {}) } };
}
function profileWithLook(profile, look) {
  return { ...profile, display_name: look.displayName, pet_type: look.petType, pet_name: look.petName,
    theme_colour: look.themeColour, location: look.location, pet_look: { ...look.petLook } };
}

/* ---------- reusable pickers ---------- */
/* Tiles for a list of options. Locked ones show only a padlock and the level they unlock at.
   drawThumbnail(canvas, optionId) draws a picture; without it the tile is text only. */
function renderOptionPicker(containerId, options, selectedId, level, onSelect, drawThumbnail = null, { tileClass = "", canvasWidth = 64, canvasHeight = 64 } = {}) {
  const container = element(containerId);
  container.innerHTML = options.map(option => {
    const locked = (option.unlockLevel || 1) > level;
    // Locked options stay a surprise: no name or picture, just a padlock and the level.
    if (locked) return `<button type="button" class="tile locked" disabled aria-label="Locked. Unlocks at level ${option.unlockLevel}">${LOCK_ICON}<span>Lv ${option.unlockLevel}</span></button>`;
    return `<button type="button" class="tile ${drawThumbnail ? tileClass : "text"}" data-option="${option.id}" aria-pressed="${option.id === selectedId}">`
      + (drawThumbnail ? `<canvas width="${canvasWidth}" height="${canvasHeight}"></canvas>` : "")
      + `${option.label}</button>`;
  }).join("");
  container.querySelectorAll(".tile:not(.locked)").forEach(tile => {
    if (drawThumbnail) drawThumbnail(tile.querySelector("canvas"), tile.dataset.option);
    tile.onclick = () => onSelect(tile.dataset.option);
  });
}
function renderColourPicker(containerId, selectedColourId, onSelect) {
  const container = element(containerId);
  container.innerHTML = THEME_COLOURS.map(colour =>
    `<button type="button" class="tile" data-colour="${colour.id}" aria-pressed="${colour.id === selectedColourId}" title="${colour.label}"><span class="chip" style="background:${hsl(colour.hue, colour.saturation, colour.swatchLightness || colour.accentLightness || 45)}"></span><span class="visually-hidden">${colour.label}</span></button>`).join("");
  container.querySelectorAll(".tile").forEach(tile => tile.onclick = () => onSelect(tile.dataset.colour));
}
/* ---------- start-up routing ---------- */
async function routeAfterSignIn(profile) {
  sessionEnded = false;
  currentProfile = profile;
  if (profile.role === "parent") { await openParentHome(); return; }
  applyThemeColour(profile.theme_colour);
  if (!profile.setup_complete) { startSetup(); return; }
  await openGame();
}
async function startApp() {
  showScreen("screenLoading");
  try {
    const profile = await dataLayer.getSignedInProfile();
    if (profile) await routeAfterSignIn(profile); else openLogin();
  } catch (error) { openLogin(); }
}

/* ---------- log in ---------- */
/* Homepage picture: every buddy type from content/pets/, kitted out, in the Pixel Arena. */
const LOGIN_OUTFITS = [
  { items: ["crown", "pixel-sword"], look: { face: "grin", arms: "down" } },
  { items: ["party-hat", "bow-tie", "balloon"], look: { face: "happy", arms: "wave" } },
  { items: ["headset", "backpack", "fishing-rod"], look: { face: "cheeky", arms: "down" } },
  { items: ["hero-cape", "star-badge", "battle-hammer"], look: { face: "determined", arms: "down" } }
];
function openLogin() {
  applyThemeColour("green");
  element("loginError").textContent = "";
  showScreen("screenLogin");
  drawHomepageScene();
}
function drawHomepageScene() {
  const scene = element("loginScene"), background = scene.querySelector(".stage-bg");
  // The homepage picture uses the gaming world (Pixel Arena), falling back to any outdoor place.
  const place = LOCATIONS.find(location => location.id === "pixel-arena") || LOCATIONS.find(location => !location.showsHouse) || LOCATIONS[0];
  background.width = Math.max(40, Math.round((scene.clientWidth || 360) / 4));
  background.height = Math.max(30, Math.round((scene.clientHeight || 190) / 4));
  drawLocationScene(background, place.id, getThemeColour("green"), [], [], {});
  const buddies = element("loginBuddies");
  buddies.innerHTML = PET_ORDER.map(() => `<canvas width="140" height="120"></canvas>`).join("");
  buddies.querySelectorAll("canvas").forEach((canvas, index) => {
    const outfit = LOGIN_OUTFITS[index % LOGIN_OUTFITS.length];
    drawPet(canvas, PET_ORDER[index], { fitTight: true, equipped: outfit.items.filter(itemId => getInventoryItem(itemId)), petLook: { ...DEFAULT_PET_LOOK, ...outfit.look }, itemColours: {} });
  });
}
/* Loading: a random buddy from the master list (content/pets/) hops and spins. */
function randomPetType() { return PET_ORDER[Math.floor(Math.random() * PET_ORDER.length)]; }
function drawLoadingBuddy(canvas) { drawPet(canvas, randomPetType(), { fitTight: true, petLook: { ...DEFAULT_PET_LOOK, face: "grin", arms: "cheer" } }); }
function loadingBuddyHtml(message) {
  return `<div class="loading-buddy" role="status"><canvas class="loading-buddy-pet" data-loading-buddy width="112" height="112" aria-hidden="true"></canvas><span>${escapeHtml(message)}</span></div>`;
}
function drawLoadingBuddies(container) { container.querySelectorAll("[data-loading-buddy]").forEach(drawLoadingBuddy); }
/* ---------- Log in pop-up and the Parents and carers page ---------- */
function openLoginSheet(message = "") {
  element("forgotPasscodeForm").hidden = true; element("loginForm").hidden = false;
  element("loginError").textContent = message;
  element("loginSheet").hidden = false;
  setTimeout(() => element("loginEmail").focus(), 50);
}
function closeLoginSheet() { element("loginSheet").hidden = true; }
document.querySelectorAll("[data-open-login]").forEach(button => button.onclick = () => openLoginSheet());
element("loginSheetClose").onclick = closeLoginSheet;
element("loginSheet").addEventListener("click", event => { if (event.target === element("loginSheet")) closeLoginSheet(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !element("loginSheet").hidden) closeLoginSheet(); });
function openParentsPage() { showScreen("screenParents"); applyThemeColour("green"); }
document.querySelectorAll("[data-open-parents]").forEach(button => button.onclick = openParentsPage);
element("parentsBackButton").onclick = () => openLogin();
/* Homepage buttons that jump to a section (and put the cursor in the email box for Log in). */
document.querySelectorAll("[data-scroll-to]").forEach(button => button.onclick = () => {
  closeLoginSheet();
  if (element("screenLogin").hidden) openLogin();
  const target = element(button.dataset.scrollTo);
  target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  if (button.dataset.scrollTo === "loginForm") setTimeout(() => element("loginEmail").focus({ preventScroll: true }), 300);
});
/* ---------- forgotten passcode ---------- */
element("forgotPasscodeButton").onclick = () => {
  element("loginForm").hidden = true; element("forgotPasscodeForm").hidden = false;
  element("forgotEmail").value = element("loginEmail").value.includes("@") ? element("loginEmail").value : "";
  element("forgotError").textContent = ""; element("forgotSent").textContent = "";
  element("forgotEmail").focus();
};
element("forgotBackButton").onclick = () => { element("forgotPasscodeForm").hidden = true; element("loginForm").hidden = false; };
element("forgotPasscodeForm").onsubmit = async event => {
  event.preventDefault();
  const email = element("forgotEmail").value.trim();
  element("forgotError").textContent = ""; element("forgotSent").textContent = "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { element("forgotError").textContent = "Type your email first."; return; }
  element("forgotSendButton").disabled = true;
  try {
    await dataLayer.requestPasscodeReset(email);
    element("forgotSent").textContent = "If that email has a Voxie account, a link is on its way. Open it to make a new passcode.";
  } catch (error) {
    element("forgotError").textContent = "Couldn't send it. Check your internet and try again.";
  }
  element("forgotSendButton").disabled = false;
};
element("loginForm").onsubmit = async event => {
  event.preventDefault();
  const loginName = element("loginEmail").value, passcode = element("loginPasscode").value;
  if (!loginName.trim() || !passcode) { element("loginError").textContent = "Type your username (or email) and passcode."; return; }
  element("loginButton").disabled = true;
  element("loginError").textContent = "";
  try {
    const profile = await dataLayer.signIn(loginName, passcode);
    element("loginPasscode").value = "";
    await routeAfterSignIn(profile);
  } catch (error) {
    element("loginError").textContent = error.message === "wrong-details"
      ? "That username or passcode isn't right. Try again, or ask your grown-up."
      : "Couldn't connect. Check your internet and try again.";
  }
  element("loginButton").disabled = false;
};

/* ---------- first-time setup (3 steps) ---------- */
function setupPreviewLook() { return { ...setupDraft, location: "home", level: 1, equipped: [] }; }

function startSetup() {
  setupDraft = lookFromProfile(currentProfile);
  element("setupNameInput").value = setupDraft.displayName;
  showFieldError("setupNameInput", "setupNameError", "");
  showScreen("screenSetupName");
}
/* Step 1: the game name starts as their username; they can keep it or make one up (it must not be taken). */
element("setupNameForm").onsubmit = async event => {
  event.preventDefault();
  const { name, error } = validateName(element("setupNameInput").value, MAX_GAME_NAME_LENGTH);
  showFieldError("setupNameInput", "setupNameError", error);
  if (error) return;
  const takenError = await gameNameError(name);
  showFieldError("setupNameInput", "setupNameError", takenError);
  if (takenError) return;
  setupDraft.displayName = name;
  openSetupPet();
};

/* Step 2: only the starter buddies. The rest are collected by rebirth. */
function openSetupPet() {
  showScreen("screenSetupPet");
  const starterOptions = PET_OPTIONS.filter(option => STARTER_PET_TYPES.includes(option.id));
  const selectPet = petType => {
    setupDraft.petType = petType;
    renderStage(element("setupPetStage"), setupPreviewLook());
    renderOptionPicker("setupPetPicker", starterOptions, petType, 1, selectPet, (canvas, optionId) => drawPet(canvas, optionId, { fitTight: true }));
    element("setupPetNameLabel").textContent = `Name your ${PET_TYPES[petType].label.toLowerCase()}`;
  };
  selectPet(starterOptions.some(option => option.id === setupDraft.petType) ? setupDraft.petType : starterOptions[0].id);
  element("setupPetNameInput").value = setupDraft.petName;
  showFieldError("setupPetNameInput", "setupPetNameError", "");
}
element("setupPetBack").onclick = () => showScreen("screenSetupName");
element("setupPetForm").onsubmit = event => {
  event.preventDefault();
  const { name, error } = validateName(element("setupPetNameInput").value);
  showFieldError("setupPetNameInput", "setupPetNameError", error);
  if (error) return;
  setupDraft.petName = name;
  openSetupLook();
};

function openSetupLook() {
  showScreen("screenSetupLook");
  const refresh = () => {
    applyThemeColour(setupDraft.themeColour);
    renderStage(element("setupLookStage"), setupPreviewLook());
    renderColourPicker("setupColourPicker", setupDraft.themeColour, colourId => { setupDraft.themeColour = colourId; refresh(); });
  };
  refresh();
  element("setupLookError").textContent = "";
}
element("setupLookBack").onclick = openSetupPet;
async function confirmSetup() {
  const button = element("setupLookConfirm");
  button.disabled = true;
  try {
    currentProfile = await dataLayer.saveProfileSetup(setupDraft);
    hideSaveError();
    await openGame();
  } catch (error) {
    button.disabled = false;
    // Someone took their game name in the meantime: back to step 1 to pick another.
    if (error.message === "name-taken") {
      showScreen("screenSetupName");   // keeps their buddy and colour choices in setupDraft
      element("setupNameInput").value = setupDraft.displayName;
      showFieldError("setupNameInput", "setupNameError", NAME_TAKEN_MESSAGE);
      return;
    }
    showSaveError("Couldn't save your buddy. Check your internet and try again.", confirmSetup);
  }
  button.disabled = false;
}
element("setupLookConfirm").onclick = confirmSetup;

/* A grown-up may change the child's settings at any time: pick up the latest when the game loads and on every tab. */
const GROWN_UP_SETTING_FIELDS = ["timed_missions", "reset_streak_on_miss", "chance_features", "child_can_change_settings", "grown_up_names", "birth_month", "birth_year"];
function takeGrownUpSettings(fresh) {
  if (!fresh || !currentProfile || fresh.id !== currentProfile.id) return;
  currentProfile = { ...currentProfile, ...Object.fromEntries(GROWN_UP_SETTING_FIELDS.map(field => [field, fresh[field]])) };
}
function refreshGrownUpSettings() { dataLayer.getSignedInProfile().then(takeGrownUpSettings).catch(() => {}); }

/* ---------- tabs ---------- */
/* More (+) opens a menu with the tabs that don't fit in the bar (Buddies and Friends). */
function closeMoreMenu() { element("moreMenu").hidden = true; element("moreTab").setAttribute("aria-expanded", "false"); }
element("moreTab").onclick = () => {
  const opening = element("moreMenu").hidden;
  element("moreMenu").hidden = !opening;
  element("moreTab").setAttribute("aria-expanded", String(opening));
};
document.addEventListener("click", event => { if (!element("moreMenu").hidden && !element("tabBar").contains(event.target)) closeMoreMenu(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !element("moreMenu").hidden) { closeMoreMenu(); element("moreTab").focus(); } });
document.querySelectorAll(".tab[data-tab]").forEach(tab => tab.onclick = () => {
  hideSaveError();
  hideLevelUp();
  applyThemeColour(currentProfile.theme_colour);
  if (reloadIfNewDay()) return;
  const tabName = tab.dataset.tab;
  if (tabName !== "friends") refreshFriendRequests();
  refreshGrownUpSettings();
  if (tabName === "home") openHome();
  if (tabName === "inventory") openInventory();
  if (tabName === "places") { if (lastPlacesScreen === "screenLocations") openLocations(); else openHouse(); }
  if (tabName === "buddies") openBuddies();
  if (tabName === "friends") openFriends();
  if (tabName === "games") openGames();
  if (tabName === "school") openSchool();
});
function openHome() { showScreen("screenGame"); renderHome(); showNewTaskNotifications(true); }
/* ---------- School tab (feature "school") ----------
   The timetable and homework the grown-up's MyChildAtSchool (MCAS) account syncs in. Times are UK school times,
   so dates and times stay as "2026-10-15" / "08:50" strings and are compared with getTodayInUk(). */
let mySchool = null;              // { linked, updatedAt, schoolDays, lessons, homework } from dataLayer.loadMySchool()
let schoolPickedDay = null;       // the day the timetable is showing

async function openSchool() {
  if (!featureOn("school")) { openHome(); return; }
  showScreen("screenSchool");
  element("schoolLoadError").hidden = true;
  if (mySchool) renderSchool();   // show what we had straight away, then refresh
  try { [mySchool, schoolSettings, homeworkDone] = await Promise.all([dataLayer.loadMySchool(), dataLayer.loadMySchoolSettings(), dataLayer.loadMyHomeworkDone()]); }
  catch (error) { if (!mySchool) element("schoolLoadError").hidden = false; return; }
  renderSchool();
}

function renderSchool() {
  const linked = !!(mySchool && mySchool.linked);
  element("schoolNotLinked").hidden = linked;
  element("schoolTimetable").hidden = !linked;
  element("schoolHomework").hidden = !linked;
  element("schoolUpdated").textContent = linked && mySchool.updatedAt ? `From MyChildAtSchool, updated ${schoolUpdatedLabel(mySchool.updatedAt)}.` : "";
  if (!linked) return;
  renderSchoolDays();
  renderSchoolLessons();
  renderSchoolHomework();
}

/* Today and the school days after it. Weekends and days off (INSET, holidays) aren't in schoolDays, so they're skipped. */
function upcomingSchoolDays() { const today = getTodayInUk(); return mySchool.schoolDays.filter(day => day >= today); }
function renderSchoolDays() {
  const days = upcomingSchoolDays();
  if (!days.includes(schoolPickedDay)) schoolPickedDay = days[0] || null;
  element("schoolDays").innerHTML = days.map(day =>
    `<button type="button" class="school-day" data-day="${day}" aria-pressed="${day === schoolPickedDay}">${escapeHtml(schoolDayLabel(day))}</button>`).join("");
  element("schoolDays").querySelectorAll("[data-day]").forEach(button => button.onclick = () => {
    schoolPickedDay = button.dataset.day;
    element("schoolDays").querySelectorAll("[data-day]").forEach(other => other.setAttribute("aria-pressed", String(other === button)));
    renderSchoolLessons();
  });
}
function renderSchoolLessons() {
  const lessons = mySchool.lessons.filter(lesson => lesson.date === schoolPickedDay);
  element("schoolLessons").innerHTML = !schoolPickedDay ? `<li class="hint">No more school days coming up.</li>`
    : !lessons.length ? `<li class="hint">No lessons on this day.</li>`
    : lessons.map(lesson => `<li class="school-lesson" style="--subject:${safeColour(lesson.colour)}">
        <span class="school-lesson-time">${escapeHtml(lesson.start)}<span class="hint">${escapeHtml(lesson.end)}</span></span>
        <span class="school-lesson-what"><strong>${escapeHtml(lesson.subject)}</strong><span class="hint">${escapeHtml(lesson.teachers.join(" & "))}</span></span>
      </li>`).join("");
}

/* Not handed in first, soonest due at the top. Overdue ones stay until MCAS says they're handed in. */
function renderSchoolHomework() {
  const homework = [...mySchool.homework].sort((a, b) => Number(a.submitted) - Number(b.submitted) || `${a.dueDate} ${a.dueTime}`.localeCompare(`${b.dueDate} ${b.dueTime}`));
  element("schoolHomeworkList").innerHTML = !homework.length ? `<p class="hint">No homework right now. Nice!</p>`
    : homework.map(item => {
      const due = homeworkDueLabel(item), tick = homeworkTick(item.id), finished = item.submitted || !!tick;
      const status = item.submitted ? "Handed in" : tick ? "Done" : due.text;
      return `<details class="school-homework${finished ? " done" : ""}" data-due="${due.urgency}">
        <summary>
          <span class="school-homework-title"><strong>${escapeHtml(item.title)}</strong><span class="hint">${escapeHtml(item.subject || "From Teams")}</span></span>
          <span class="school-due">${escapeHtml(status)}</span>
        </summary>
        <div class="school-homework-body">
          ${item.instructions ? `<p class="school-instructions">${escapeHtml(item.instructions)}</p>` : ""}
          ${homeworkLinksHtml(item)}
          ${item.setBy ? `<p class="hint">Set by ${escapeHtml(item.setBy)}</p>` : ""}
          ${canTickInSchool(item) ? `<button type="button" class="btn small" data-tick-homework="${escapeHtml(item.id)}">I've done it: +${HOMEWORK_XP} XP</button>` : ""}
          ${tick && !item.submitted ? `<p class="hint">Ticked off${tick.completedOn === getTodayInUk() ? " today" : ""}.</p>` : ""}
        </div>
      </details>`;
    }).join("");
  element("schoolHomeworkList").querySelectorAll("[data-tick-homework]").forEach(button => button.onclick = () => tickHomeworkInSchool(button));
}
/* Not handed in, not ticked, and on Home already or late (a teacher may give more time without changing MCAS). */
function canTickInSchool(item) {
  return !item.submitted && !homeworkTick(item.id) && !!schoolSettings
    && shiftDate(item.dueDate, -schoolSettings.homeworkTaskDaysBefore) <= getTodayInUk();
}
async function tickHomeworkInSchool(button) {
  const homeworkId = button.dataset.tickHomework;
  button.disabled = true;
  try {
    const { xpAwarded, levelPoints } = await dataLayer.markHomeworkDone(homeworkId);
    homeworkDone = [...homeworkDone.filter(tick => tick.homeworkId !== homeworkId), { homeworkId, completedOn: getTodayInUk() }];
    currentProgress.xpEarned += xpAwarded;
    if (levelPoints) addLevelPoints(levelPoints);
    hideSaveError();
    renderSchoolHomework();
    renderHomeworkTasks();
  } catch (error) {
    button.disabled = false;
    showSaveError("Couldn't save that. Check your internet and try again.", () => tickHomeworkInSchool(button));
  }
}

/* A button for each link, to the site the homework is done on. */
function homeworkLinksHtml(item) {
  const links = item.links.filter(link => safeLink(link.url));
  return links.length ? `<ul class="school-links">${links.map(link => `<li><a class="btn small ghost" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label || new URL(link.url).hostname)} ↗</a></li>`).join("")}</ul>` : "";
}
/* Teachers type these links, so only https links are shown. */
function safeLink(url) { try { return new URL(url).protocol === "https:"; } catch (error) { return false; } }
/* MCAS subject colours are 6-digit hex without the "#". */
function safeColour(hex) { return /^[0-9a-f]{6}$/i.test(hex || "") ? `#${hex}` : "var(--line)"; }

function schoolDayLabel(day) {
  const today = getTodayInUk();
  if (day === today) return "Today";
  if (day === shiftDate(today, 1)) return "Tomorrow";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
}
/* { text: "Due tonight", urgency: "late" | "soon" | "later" }. "soon" is today or tomorrow. */
function homeworkDueLabel(item) {
  const today = getTodayInUk(), lateInDay = item.dueTime >= "18:00";
  const nowTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(new Date());
  if (item.dueDate < today || (item.dueDate === today && item.dueTime < nowTime)) return { text: "Late", urgency: "late" };
  if (item.dueDate === today) return { text: lateInDay ? "Due tonight" : `Due today ${item.dueTime}`, urgency: "soon" };
  if (item.dueDate === shiftDate(today, 1)) return { text: lateInDay ? "Due tomorrow" : `Due tomorrow ${item.dueTime}`, urgency: "soon" };
  const date = new Date(`${item.dueDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return { text: `Due ${date}`, urgency: "later" };
}
function schoolUpdatedLabel(isoTime) {
  const minutes = Math.round((Date.now() - new Date(isoTime).getTime()) / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} hour${hours === 1 ? "" : "s"} ago` : new Date(isoTime).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* ---------- Homework tasks on Home (feature "school") ----------
   Homework that isn't handed in shows up in Today's tasks from homeworkTaskDaysBefore days before it's due. It's not a
   scheduled task and doesn't count towards MAX_TASKS_PER_DAY. Everything needed is on the task: what to do, who set it
   and a button to the site it's done on. A ticked one stays (crossed out) until it's due, so a tick can be undone.
   Once its due time has passed it comes off Home, ticked or not (there'd be no way to clear it otherwise). The
   School tab still shows it as Late, with "I've done it" in case the teacher gave more time. */
const MAX_HOMEWORK_TASK_DAYS_BEFORE = 7;
const HOMEWORK_XP = 3, HOMEWORK_LEVEL_POINTS = 2;   // the server's numbers too (mark_homework_done): keep them the same
let schoolSettings = null;        // { homeworkTaskDaysBefore } from dataLayer.loadMySchoolSettings()
let homeworkDone = [];            // [{ homeworkId, completedOn }]: ticked off on Home
const homeworkTick = homeworkId => homeworkDone.find(tick => tick.homeworkId === homeworkId);
async function loadHomeworkTasks() {
  if (!featureOn("school")) { renderHomeworkTasks(); return; }
  try { [mySchool, schoolSettings, homeworkDone] = await Promise.all([dataLayer.loadMySchool(), dataLayer.loadMySchoolSettings(), dataLayer.loadMyHomeworkDone()]); }
  catch (error) { return; }       // Home works without it; it comes back next time the game loads
  renderHomeworkTasks();
  showHandedInHomework();
}

/* Homework MCAS says is handed in (the overnight sync), due in the last 7 days or later, that wasn't ticked here:
   one pop-up to collect its XP and level points. The server works out what's collectable and gives each one only
   once, whether it was ticked or collected. Closing without collecting shows it again next time. */
let handedInToCollect = [];
function showHandedInHomework() {
  if (!featureOn("school") || !mySchool || !mySchool.linked || element("screenGame").hidden) return;
  if (!element("childNoticeSheet").hidden || !element("handedInSheet").hidden) return;   // one pop-up at a time
  const today = getTodayInUk();
  handedInToCollect = mySchool.homework.filter(item => item.submitted && !homeworkTick(item.id) && item.dueDate >= shiftDate(today, -7));
  if (!handedInToCollect.length) return;
  const count = handedInToCollect.length;
  element("handedInTitle").textContent = count === 1 ? "You handed in homework!" : `You handed in ${count} homeworks!`;
  element("handedInText").textContent = `MyChildAtSchool says ${count === 1 ? "this is" : "these are"} done. Nice work!`;
  element("handedInList").innerHTML = handedInToCollect.map(item =>
    `<li><span class="power-text"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.subject || "From Teams")}</span></span></li>`).join("");
  element("handedInError").textContent = "";
  setButtonText(element("handedInCollect"), `Collect ${count * HOMEWORK_XP} XP`);
  element("handedInCollect").disabled = false;
  element("handedInSheet").hidden = false;
  element("handedInCollect").focus();
}
function closeHandedInHomework() { element("handedInSheet").hidden = true; handedInToCollect = []; }
element("handedInCollect").onclick = async () => {
  element("handedInCollect").disabled = true;
  try {
    const { homework, xpAwarded, levelPoints } = await dataLayer.collectHandedInHomework();
    homeworkDone = [...homeworkDone.filter(tick => !homework.some(item => item.id === tick.homeworkId)),
      ...homework.map(item => ({ homeworkId: item.id, completedOn: getTodayInUk() }))];
    closeHandedInHomework();
    currentProgress.xpEarned += xpAwarded;
    if (levelPoints) addLevelPoints(levelPoints);
    renderProgress();
    renderHomeworkTasks();
  } catch (error) {
    element("handedInError").textContent = "Couldn't collect it. Check your internet and try again.";
    element("handedInCollect").disabled = false;
  }
};
element("handedInSheet").addEventListener("click", event => { if (event.target === element("handedInSheet")) closeHandedInHomework(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !element("handedInSheet").hidden) closeHandedInHomework(); });
function homeworkTasksToday() {
  if (!featureOn("school") || !mySchool || !mySchool.linked || !schoolSettings) return [];
  const today = getTodayInUk();
  return mySchool.homework
    .filter(item => !item.submitted && shiftDate(item.dueDate, -schoolSettings.homeworkTaskDaysBefore) <= today && homeworkDueLabel(item).urgency !== "late")
    .sort((a, b) => `${a.dueDate} ${a.dueTime}`.localeCompare(`${b.dueDate} ${b.dueTime}`));
}
function renderHomeworkTasks() {
  const tasks = homeworkTasksToday();
  element("homeworkTaskArea").hidden = !tasks.length;
  element("homeworkTaskHint").textContent = `Each homework done = ${HOMEWORK_XP} XP and ${HOMEWORK_LEVEL_POINTS} level points.`;
  const today = getTodayInUk();
  element("homeworkTaskList").innerHTML = tasks.map(item => {
    const due = homeworkDueLabel(item), tick = homeworkTick(item.id);
    // Like other tasks, a tick can only be undone on the day it was made.
    const tickAttributes = tick ? `checked${tick.completedOn === today ? "" : " disabled"}` : "";
    const about = [item.subject || "From Teams", item.setBy && `set by ${item.setBy}`].filter(Boolean).join(", ");
    return `<li class="homework-task" data-due="${due.urgency}">
      <div class="chore"><label><input type="checkbox" data-homework-id="${escapeHtml(item.id)}" ${tickAttributes}><span class="homework-task-title"><strong>${escapeHtml(item.title)}</strong><span class="hint">${escapeHtml(about)}</span></span><span class="school-due">${escapeHtml(due.text)}</span></label></div>
      ${homeworkLinksHtml(item)}
      <details class="homework-task-more">
        <summary>What to do</summary>
        <p class="school-instructions">${escapeHtml(item.instructions || "Your teacher didn't add any instructions. Ask them if you're not sure.")}</p>
        <button type="button" class="linkish" data-open-school>See all your homework</button>
      </details>
    </li>`;
  }).join("");
  element("homeworkTaskList").querySelectorAll("input[data-homework-id]").forEach(checkbox => checkbox.onchange = () => toggleHomeworkTask(checkbox));
  element("homeworkTaskList").querySelectorAll("[data-open-school]").forEach(button => button.onclick = openSchool);
}
/* Ticking gives HOMEWORK_XP to spend and HOMEWORK_LEVEL_POINTS to the playing buddy (worked out on the server).
   Unticking reloads progress from the server, like other tasks. */
async function toggleHomeworkTask(checkbox) {
  const homeworkId = checkbox.dataset.homeworkId, nowDone = checkbox.checked;
  checkbox.disabled = true;
  try {
    if (nowDone) {
      const { xpAwarded, levelPoints } = await dataLayer.markHomeworkDone(homeworkId);
      homeworkDone = [...homeworkDone.filter(tick => tick.homeworkId !== homeworkId), { homeworkId, completedOn: getTodayInUk() }];
      currentProgress.xpEarned += xpAwarded;
      if (levelPoints) addLevelPoints(levelPoints);
    } else {
      await dataLayer.unmarkHomeworkDone(homeworkId);
      homeworkDone = homeworkDone.filter(tick => tick.homeworkId !== homeworkId);
      try { currentProgress = await dataLayer.loadProgressSummary(); } catch (error) {}
    }
    hideSaveError();
    renderProgress();
    renderHomeworkTasks();
  } catch (error) {
    checkbox.checked = !nowDone;
    checkbox.disabled = false;
    if (error.message === "xp-spent") { showSaveError("You've already spent that XP, so this homework stays ticked."); return; }
    if (error.message === "not-today") { showSaveError("You ticked this on another day, so it stays ticked."); return; }
    if (error.message === "too-early") { loadHomeworkTasks(); return; }
    if (error.message === "handed-in") { showSaveError("MCAS says you handed this in, so it stays ticked."); return; }
    showSaveError("Couldn't save that. Check your internet and try again.", () => { checkbox.checked = nowDone; toggleHomeworkTask(checkbox); });
  }
}

/* Settings: how many days before it's due homework goes in Today's tasks (0 = on the day). */
async function renderSchoolSettings() {
  element("schoolSettingsSection").hidden = !featureOn("school");
  element("schoolSettingsError").textContent = "";
  if (!featureOn("school")) return;
  if (!schoolSettings) { try { schoolSettings = await dataLayer.loadMySchoolSettings(); } catch (error) { element("schoolSettingsSection").hidden = true; return; } }
  const days = schoolSettings.homeworkTaskDaysBefore;
  element("homeworkDaysValue").textContent = days;
  element("homeworkDaysDown").disabled = days <= 0;
  element("homeworkDaysUp").disabled = days >= MAX_HOMEWORK_TASK_DAYS_BEFORE;
  element("homeworkDaysHint").textContent = days === 0 ? "On the day it's due." : `${days} day${days === 1 ? "" : "s"} before it's due, so there's time to get it done.`;
  renderReminderSetting();
}
async function changeHomeworkTaskDays(change) {
  if (!schoolSettings) return;
  const days = Math.min(MAX_HOMEWORK_TASK_DAYS_BEFORE, Math.max(0, schoolSettings.homeworkTaskDaysBefore + change));
  if (days === schoolSettings.homeworkTaskDaysBefore) return;
  const before = schoolSettings;
  schoolSettings = { ...schoolSettings, homeworkTaskDaysBefore: days };
  renderSchoolSettings();
  try { await dataLayer.saveMySchoolSettings({ homeworkTaskDaysBefore: days }); }
  catch (error) { schoolSettings = before; renderSchoolSettings(); element("schoolSettingsError").textContent = "Couldn't save that. Check your internet and try again."; }
}
element("homeworkDaysDown").onclick = () => changeHomeworkTaskDays(-1);
element("homeworkDaysUp").onclick = () => changeHomeworkTaskDays(1);

/* ---------- Homework reminders (push notifications, feature "school") ----------
   Turned on per device. The browser makes a push address for this device (sw.js shows what arrives) and it's saved
   to the child's account; the send-reminders Edge Function sends at most one a day, at the time the child picks (Reminder time).
   On iPhone and iPad, notifications only work once Voxie is added to the home screen. */
const REMINDER_HOURS = Array.from({ length: 15 }, (_, index) => index + 7);   // 7am to 9pm, the server's limits too
const hourText = hour => hour === 12 ? "12 noon" : hour < 12 ? `${hour}am` : `${hour - 12}pm`;
const reminderTimeText = () => hourText(schoolSettings ? schoolSettings.reminderHour : 16);
element("reminderTimeSelect").innerHTML = REMINDER_HOURS.map(hour => `<option value="${hour}">${hourText(hour)}</option>`).join("");
element("reminderTimeSelect").onchange = async event => {
  const reminderHour = Number(event.target.value), before = schoolSettings;
  schoolSettings = { ...schoolSettings, reminderHour };
  renderReminderSetting();
  try { await dataLayer.saveMySchoolSettings({ reminderHour }); }
  catch (error) { schoolSettings = before; renderSchoolSettings(); element("schoolSettingsError").textContent = "Couldn't save that. Check your internet and try again."; }
};
const voxieServiceWorker = "serviceWorker" in navigator ? navigator.serviceWorker.register("/voxie/sw.js", { scope: "/voxie/" }).catch(() => null) : Promise.resolve(null);
function pushPossible() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && typeof VOXIE_VAPID_PUBLIC_KEY === "string" && !!VOXIE_VAPID_PUBLIC_KEY;
}
/* Subscribing needs the service worker running, and the first time it can still be starting up. */
async function activeServiceWorker() {
  const registration = await voxieServiceWorker;
  if (!registration || registration.active) return registration;
  const worker = registration.installing || registration.waiting;
  if (worker) await new Promise(resolve => { const check = () => { if (worker.state === "activated") resolve(); }; worker.addEventListener("statechange", check); check(); });
  return registration;
}
async function currentPushSubscription() {
  const registration = await voxieServiceWorker;
  return registration ? registration.pushManager.getSubscription() : null;
}
/* A "reminders on this device" switch. The child's is in Settings → School; a grown-up's is in Lesson reminders. */
const CHILD_REMINDER_SWITCH = { toggle: "settingReminders", hint: "remindersHint", error: "schoolSettingsError",
  onText: () => `On for this device. You'll get one at ${reminderTimeText()} when homework is due tonight or tomorrow, or has just come onto Home.`,
  offText: () => `Get a notification on this device at ${reminderTimeText()} when homework is due soon.` };
const GROWN_UP_REMINDER_SWITCH = { toggle: "parentRemindersSwitch", hint: "parentRemindersHint", error: "parentLessonError",
  onText: () => "On for this device: the lesson reminders below, and a copy of homework reminders.",
  offText: () => "Turn on to get lesson reminders and a copy of homework reminders on this device." };
async function renderReminderSetting() {
  if (schoolSettings) element("reminderTimeSelect").value = String(schoolSettings.reminderHour);
  await renderPushSwitch(CHILD_REMINDER_SWITCH);
}
async function renderPushSwitch(config) {
  const toggle = element(config.toggle), hint = element(config.hint);
  toggle.disabled = true;
  if (!pushPossible()) {
    toggle.checked = false;
    hint.textContent = isAppleDevice() && !isInstalledApp() ? "Add Voxie to your home screen first, then turn this on there."
      : "This browser can't do notifications.";
    return;
  }
  if (Notification.permission === "denied") {
    toggle.checked = false;
    hint.textContent = "Notifications are blocked for Voxie. Allow them in this browser's site settings, then come back.";
    return;
  }
  const subscription = Notification.permission === "granted" ? await currentPushSubscription().catch(() => null) : null;
  toggle.checked = !!subscription;
  toggle.disabled = false;
  hint.textContent = subscription ? config.onText() : config.offText();
}
/* The browser's push key has to be bytes, not the base64url text it's shared as. */
function vapidKeyBytes(base64Url) {
  const base64 = (base64Url + "=".repeat((4 - base64Url.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}
function wirePushSwitch(config) {
  element(config.toggle).onchange = async event => {
    const turningOn = event.target.checked;
    element(config.toggle).disabled = true;
    element(config.error).textContent = "";
    try {
      if (turningOn) {
        // Asked for here, straight after the tap: browsers only ask when the person has just pressed something.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          await renderPushSwitch(config);
          if (permission === "default") element(config.error).textContent = "Notifications weren't allowed. Look for a bell icon at the end of the address bar, click it and choose Allow, then try again.";
          return;
        }
        const registration = await activeServiceWorker();
        if (!registration) throw new Error("no-service-worker");
        const subscription = await registration.pushManager.getSubscription()
          || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(VOXIE_VAPID_PUBLIC_KEY) });
        const { endpoint, keys } = subscription.toJSON();
        await dataLayer.savePushSubscription({ endpoint, p256dh: keys.p256dh, auth: keys.auth });
      } else {
        await turnOffRemindersHere();
      }
    } catch (error) {
      console.error("Reminders:", error);
      // The bit in brackets says what went wrong, for whoever's fixing it.
      element(config.error).textContent = error.message === "too-many-devices" ? "Reminders are already on for 10 devices. Turn them off on one first."
        : `Couldn't change reminders. Check your internet and try again. (${error.name && error.name !== "Error" ? `${error.name}: ` : ""}${error.message})`;
    }
    await renderPushSwitch(config);
  };
}
wirePushSwitch(CHILD_REMINDER_SWITCH);
wirePushSwitch(GROWN_UP_REMINDER_SWITCH);
/* Also on log out, so a shared tablet doesn't keep getting the last child's reminders. */
async function turnOffRemindersHere() {
  const subscription = await currentPushSubscription().catch(() => null);
  if (!subscription) return;
  await dataLayer.removePushSubscription(subscription.endpoint);
  await subscription.unsubscribe();
}

/* ---------- Games tab ----------
   Mini-games to play with your buddy.
   Each game saves its result through the dataLayer; the server gives the XP, at most MAX_GAME_XP_PER_DAY a day from EACH game. */
const MAX_GAME_XP_PER_DAY = 10;   // the server's limit too (private.game_xp_to_award): keep them the same
let gameXpToday = {};             // { "ping-pong": 4, snap: 3 }
/* "Lose my points if I lose" (every game) is in Settings. It's remembered on this device for each child. */
const GAMES_RISK_KEY = () => `voxie-games-lose-points:${currentProfile.id}`;
function losePointsOnLoss() { try { return localStorage.getItem(GAMES_RISK_KEY()) === "on"; } catch (error) { return false; } }
element("gamesRiskSwitch").onchange = event => { try { localStorage.setItem(GAMES_RISK_KEY(), event.target.checked ? "on" : "off"); } catch (error) {} };
function renderGamesSetting() {
  element("gamesRiskSwitch").checked = losePointsOnLoss();
}

async function openGames() {
  showScreen("screenGames");
  renderGamesXpToday();
  renderPong();
  renderSnap();
  try { gameXpToday = await dataLayer.loadMyGameXpToday(); renderGamesXpToday(); } catch (error) {}
}
/* Each game shows its own "X of 10 XP today". */
const GAME_XP_LINES = { "ping-pong": "pongXpToday", snap: "snapXpToday" };
function renderGamesXpToday() {
  Object.entries(GAME_XP_LINES).forEach(([game, lineId]) => {
    const xp = gameXpToday[game] || 0;
    element(lineId).textContent = xp >= MAX_GAME_XP_PER_DAY
      ? `You've got all ${MAX_GAME_XP_PER_DAY} XP from this game today. Keep playing for fun, and come back tomorrow for more!`
      : `XP from this game today: ${xp} of ${MAX_GAME_XP_PER_DAY}.`;
  });
}
function addGameXp(game, xpAwarded) {
  currentProgress.xpEarned += xpAwarded;
  gameXpToday = { ...gameXpToday, [game]: (gameXpToday[game] || 0) + xpAwarded };
  renderGamesXpToday();
}

/* ---------- Ping pong (engine/pong.js) ---------- */
/* The court moves through every location in the game, one per match, in the Places order (starting at Mountains).
   Where it's got to is remembered on this device for each child. */
const pongCourts = () => [...LOCATIONS].sort((first, second) => first.unlockLevel - second.unlockLevel);
const PONG_COURT_KEY = () => `voxie-pong-court:${currentProfile.id}`;
function pongCourt() {
  const courts = pongCourts();
  let saved = null;
  try { saved = localStorage.getItem(PONG_COURT_KEY()); } catch (error) {}
  return courts.find(location => location.id === saved) || courts.find(location => location.id === "mountains") || courts[0];
}
function moveToNextPongCourt() {
  const courts = pongCourts(), next = courts[(courts.indexOf(pongCourt()) + 1) % courts.length];
  try { localStorage.setItem(PONG_COURT_KEY(), next.id); } catch (error) {}
}
let pongGame = null, pongBotPetType = null, pongRiskThisMatch = false;
function pongScene() {
  const look = gameLook(), court = pongCourt();
  element("pongCourtName").textContent = `Court: ${court.label}`;
  element("pongCourt").setAttribute("aria-label", `Ping pong court: ${court.label}. Your buddy's bat is on the left.`);
  return { locationId: court.id, themeColour: getThemeColour(look.themeColour), botPetType: pongBotPetType,
    look: { petType: look.petType, petLook: look.petLook, equipped: look.equipped, level: look.level, itemColours: myItemColours } };
}
/* The bot is a different kind of buddy each match. */
function pickPongBot() {
  const others = PET_ORDER.filter(petType => petType !== lookFromProfile(currentProfile).petType);
  pongBotPetType = others[Math.floor(Math.random() * others.length)] || PET_ORDER[0];
}
function renderPongScore(myPoints, botPoints) {
  element("pongScore").innerHTML = `<span>${escapeHtml(petName() || "You")}</span><strong>${myPoints} – ${botPoints}</strong><span>Bot ${escapeHtml(PET_TYPES[pongBotPetType].label)}</span>`;
}
function renderPong() {
  if (pongGame && pongGame.isRunning()) return;
  if (!pongBotPetType) pickPongBot();
  if (pongGame) pongGame.setScene(pongScene());
  else pongGame = createPongGame(element("pongCourt"), pongScene(), { onScore: renderPongScore, onMatchEnd: finishPongMatch });
  renderPongScore(0, 0);
}
function setPongPlaying(playing) { element("pongPlay").hidden = playing; }
element("pongPlay").onclick = () => {
  hideSaveError();
  if (reloadIfNewDay()) return;
  stopSnap();   // one game at a time
  pickPongBot();
  pongGame.setScene(pongScene());
  pongRiskThisMatch = losePointsOnLoss();   // fixed for the match once it starts
  renderPongScore(0, 0);
  element("pongMessage").textContent = `First to ${PONG_POINTS_TO_WIN} wins!`;
  setPongPlaying(true);
  pongGame.start();
};
/* Leaving the screen or closing the drop-down stops a match. A match that isn't finished isn't saved. */
function stopPong() {
  if (!pongGame || !pongGame.isRunning()) return;
  pongGame.stop();
  setPongPlaying(false);
  element("pongPlay").textContent = "Play";
  element("pongMessage").textContent = "Match stopped. Press Play to start again.";
}
element("pongPanel").ontoggle = () => { if (!element("pongPanel").open) stopPong(); };
function finishPongMatch(myPoints, botPoints) {
  setPongPlaying(false);
  // The next match is somewhere new: show it now, ready for Play again.
  moveToNextPongCourt();
  pongGame.setScene(pongScene());
  element("pongPlay").textContent = "Play again";
  element("pongMessage").textContent = myPoints > botPoints ? "You win! Saving…" : "Saving…";
  savePongResult(myPoints, botPoints, pongRiskThisMatch);
}
async function savePongResult(myPoints, botPoints, losePoints) {
  try {
    const result = await dataLayer.saveGameResult("ping-pong", myPoints, botPoints, losePoints);
    addGameXp("ping-pong", result.xpAwarded);
    element("pongMessage").textContent = pongResultMessage(myPoints, botPoints, losePoints, result);
  } catch (error) {
    element("pongMessage").textContent = "";
    showSaveError("Couldn't save your match. Check your internet and try again.", () => savePongResult(myPoints, botPoints, losePoints));
  }
}
function pongResultMessage(myPoints, botPoints, losePoints, { xpAwarded, won, hitDailyLimit }) {
  const xp = points => `${points} XP`;
  const limit = hitDailyLimit ? ` That's all the XP from Ping pong for today.` : "";
  if (won) return `You win ${myPoints}–${botPoints}! +${xp(xpAwarded)}.${limit}`;
  const lost = `Bot ${PET_TYPES[pongBotPetType].label} wins ${botPoints}–${myPoints}.`;
  if (myPoints === 0) return `${lost} Have another go!`;
  if (losePoints) return `${lost} You lose the ${xp(myPoints)} from this match.`;
  return `${lost} You keep ${xp(xpAwarded)}.${limit}`;
}

/* ---------- Snap (engine/snap.js) ----------
   The same game as /slap-war. 3 XP for winning (finishing above 0), 1 XP for trying. */
let snapGame = null, snapRiskThisGame = false;
const SNAP_MODE_KEY = () => `voxie-snap-mode:${currentProfile.id}`;
function snapMode() { try { const mode = localStorage.getItem(SNAP_MODE_KEY()); return SNAP_MODES[mode] ? mode : "classic"; } catch (error) { return "classic"; } }
function renderSnap() {
  if (snapGame && snapGame.isRunning()) return;
  const mode = snapMode();
  document.querySelectorAll("[data-snap-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.snapMode === mode)));
  element("snapModeHint").textContent = SNAP_MODES[mode].description;
  if (!snapGame) {
    snapGame = createSnapGame({
      arena: element("snapArena"), cards: [element("snapBotCard"), element("snapPlayerCard")],
      botNumber: element("snapBotNumber"), playerNumber: element("snapPlayerNumber"), snapButton: element("snapButton"),
      message: element("snapMessage"), score: element("snapScore"), phase: element("snapPhase"),
      progress: element("snapProgress"), countdown: element("snapCountdown"),
      overlay: element("snapOverlay"), overlaySmall: element("snapOverlaySmall"), overlayBig: element("snapOverlayBig"), overlayText: element("snapOverlayText")
    }, { onEnd: finishSnapGame });
  }
  // Your buddy on your card; a different bot buddy on theirs.
  const look = lookFromProfile(currentProfile), others = PET_ORDER.filter(petType => petType !== look.petType);
  drawPet(element("snapPlayerBuddy"), look.petType, { fitTight: true, petLook: look.petLook, equipped: currentProfile.equipped_items.filter(itemId => getInventoryItem(itemId)) });
  drawPet(element("snapBotBuddy"), others[Math.floor(Math.random() * others.length)] || PET_ORDER[0], { fitTight: true, itemColours: {} });
  element("snapPlayerName").textContent = petName() || "You";
}
document.querySelectorAll("[data-snap-mode]").forEach(button => button.onclick = () => {
  try { localStorage.setItem(SNAP_MODE_KEY(), button.dataset.snapMode); } catch (error) {}
  renderSnap();
});
function setSnapPlaying(playing) {
  element("snapSetup").hidden = playing;
  element("snapArena").hidden = !playing;
  element("snapPlay").hidden = playing;
}
element("snapPlay").onclick = () => {
  hideSaveError();
  if (reloadIfNewDay()) return;
  stopPong();   // one game at a time
  snapRiskThisGame = losePointsOnLoss();   // fixed for the game once it starts
  element("snapResult").textContent = "";
  setSnapPlaying(true);
  // Bring the whole game into view: both cards and SNAP, clear of the tab bar.
  window.scrollTo({ top: element("snapArena").getBoundingClientRect().top + window.scrollY - 12,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  snapGame.start(snapMode());
};
/* Leaving the screen, closing the drop-down or Stop ends a game without saving it. */
function stopSnap() {
  if (!snapGame || !snapGame.isRunning()) return;
  snapGame.stop();
  setSnapPlaying(false);
  element("snapPlay").textContent = "Play";
  element("snapResult").textContent = "Game stopped. Press Play to start again.";
}
element("snapStop").onclick = stopSnap;
element("snapPanel").ontoggle = () => { if (!element("snapPanel").open) stopSnap(); };
function finishSnapGame(score, won) {
  setSnapPlaying(false);
  element("snapPlay").textContent = "Play again";
  element("snapResult").textContent = won ? `You win with ${score}! Saving…` : "Saving…";
  saveSnapResult(snapMode(), score, snapRiskThisGame);
}
async function saveSnapResult(mode, score, losePoints) {
  try {
    const result = await dataLayer.saveSnapResult(mode, score, losePoints);
    addGameXp("snap", result.xpAwarded);
    element("snapResult").textContent = snapResultMessage(score, losePoints, result);
  } catch (error) {
    element("snapResult").textContent = "";
    showSaveError("Couldn't save your Snap game. Check your internet and try again.", () => saveSnapResult(mode, score, losePoints));
  }
}
function snapResultMessage(score, losePoints, { xpAwarded, won, hitDailyLimit }) {
  const limit = hitDailyLimit ? ` That's all the XP from Snap for today.` : "";
  if (won) return `You win with ${score}! +${xpAwarded} XP.${limit}`;
  if (losePoints) return `You finished on ${score}. Finish above 0 to win. You lose the XP for trying.`;
  return `You finished on ${score}. Finish above 0 to win. +${xpAwarded} XP for trying.${limit}`;
}
/* Places remembers whether House or Locations was open last. */
let lastPlacesScreen = "screenHouse";
document.querySelectorAll("[data-places]").forEach(button => button.onclick = () => {
  if (button.dataset.places === "screenLocations") openLocations(); else openHouse();
});
/* Settings can be opened from every tab (the ⚙ button). Back returns to the tab you came from. */
const REOPEN_SCREEN = { screenGame: () => openHome(), screenInventory: () => openInventory(), screenShop: () => openShop(), screenHouse: () => openHouse(),
  screenLocations: () => openLocations(), screenBuddies: () => openBuddies(), screenFriends: () => openFriends(), screenGames: () => openGames(), screenSchool: () => openSchool() };
let screenBeforeSettings = "screenGame";
document.querySelectorAll(".settings-button").forEach(button => button.onclick = () => {
  const openScreen = ALL_SCREENS.find(id => !element(id).hidden);
  screenBeforeSettings = REOPEN_SCREEN[openScreen] ? openScreen : "screenGame";
  TAB_FOR_SCREEN.screenConfig = TAB_FOR_SCREEN[screenBeforeSettings];
  openConfigScreen();
});
element("configBackButton").onclick = () => REOPEN_SCREEN[screenBeforeSettings]();

/* ---------- home ---------- */
function gameLook() {
  return { ...lookFromProfile(currentProfile), level: currentLevel(), equipped: currentProfile.equipped_items.filter(itemId => getInventoryItem(itemId)),
    retiredBuddies: myBuddies.filter(buddy => !buddy.isActive).map(buddy => ({ petType: buddy.petType, petLook: buddy.petLook })) };
}
let itemColourData = null;
/* ---------- A new day while the app is open ----------
   Ticks, missions, boxes and limits are "today" things, so when the date changes the game reloads. */
let gameLoadedOnDay = null;
function reloadIfNewDay() {
  if (currentProfile && currentProfile.setup_complete && gameLoadedOnDay && getTodayInUk() !== gameLoadedOnDay) { openGame(); return true; }
  return false;
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) reloadIfNewDay(); });
setInterval(() => { if (!document.hidden) reloadIfNewDay(); }, 60000);
/* Everything that belongs to the playing buddy: its level and XP, items, item XP, colours, chance history,
   and its own unlock order and Shop. Loaded with the game, and again after switching buddy or a rebirth. */
async function loadPlayingBuddyData() {
  let deals;
  [currentProgress, myItemXp, myPurchases, myChance, itemColourData, deals] = await Promise.all([
    dataLayer.loadProgressSummary(), dataLayer.loadMyItemXp(), dataLayer.loadMyPurchases(), dataLayer.loadMyChanceHistory(),
    dataLayer.loadMyItemColours(), dataLayer.loadMyBuddyDeals()]);
  ({ itemColours: myItemColours, gotAtLevels: myGotAtLevels } = itemColourData);
  applyBuddyDeals(deals);
}
async function openGame() {
  showScreen("screenLoading");
  try {
    let freshProfile;
    [myChores, choresDoneToday, myOwnTasksToday, myScheduledTasks, scheduledDoneToday, myBuddies, freshProfile] = await Promise.all([
      dataLayer.loadMyChores(), dataLayer.loadChoresDoneToday(), dataLayer.loadMyOwnTasksToday(),
      dataLayer.loadMyScheduledTasks(), dataLayer.loadScheduledTasksDoneToday(), dataLayer.loadMyBuddies(), dataLayer.getSignedInProfile(),
      loadPlayingBuddyData()]);
    takeGrownUpSettings(freshProfile);
  } catch (error) {
    showSaveError("Couldn't load your game. Check your internet and try again.", openGame);
    return;
  }
  gameLoadedOnDay = getTodayInUk();
  levelsSeen = {};
  showScreen("screenGame");
  renderHome();
  loadHomeworkTasks();
  refreshFriendRequests();
  showNewTaskNotifications(false);
}
/* "New tasks!" pop-up: every task a grown-up added since the child last looked, in ONE pop-up, grouped by grown-up.
   reloadTasks: fetch the task list again first (when they were added while the game was already open). */
let shownChildNotificationIds = [];
async function showNewTaskNotifications(reloadTasks) {
  let notifications;
  try { notifications = await dataLayer.loadMyTaskNotifications(); } catch (error) { return; }
  const newTasks = notifications.filter(notice => notice.kind === "task-added");
  if (!newTasks.length || element("screenGame").hidden || !element("childNoticeSheet").hidden) return;
  if (reloadTasks) {
    try { myScheduledTasks = await dataLayer.loadMyScheduledTasks(); renderChores(); } catch (error) {}
  }
  shownChildNotificationIds = newTasks.map(notice => notice.id);
  const byGrownUp = {};
  newTasks.forEach(notice => { const who = notice.fromName || "Your grown-up"; (byGrownUp[who] = byGrownUp[who] || []).push(notice.taskTitle); });
  element("childNoticeTitle").textContent = newTasks.length === 1 ? "A new task!" : "New tasks!";
  element("childNoticeList").innerHTML = Object.entries(byGrownUp).map(([who, titles]) =>
    `<li><span class="power-text"><b>${escapeHtml(who)} added ${titles.length === 1 ? "a task" : `${titles.length} tasks`}</b>`
    + `<span>${titles.map(escapeHtml).join(", ")}</span></span></li>`).join("");
  element("childNoticeSheet").hidden = false;
  element("childNoticeOk").focus();
}
function closeNewTaskNotifications() {
  if (element("childNoticeSheet").hidden) return;
  element("childNoticeSheet").hidden = true;
  dataLayer.markMyTaskNotificationsSeen(shownChildNotificationIds).catch(() => {});   // if this fails, they'll see it again next time
  shownChildNotificationIds = [];
  if (typeof showHandedInHomework === "function") showHandedInHomework();
}
element("childNoticeOk").onclick = closeNewTaskNotifications;
element("childNoticeSheet").addEventListener("click", event => { if (event.target === element("childNoticeSheet")) closeNewTaskNotifications(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeNewTaskNotifications(); });
function renderHome() {
  element("taskSnackHint").textContent = `Each task done = 1 level point and a snack for ${petName()}.`;
  maybeShowInstallBanner();
  renderProgress();
  renderChores();
  renderHomeworkTasks();
  renderMissions();
}

function xpToSpend() { return Math.max(0, currentProgress.xpEarned - currentProgress.xpSpentOnItems - currentProgress.xpSpentInShop); }
/* Shop items are yours once bought; everything else once your level is high enough. */
function isShopItem(item) { return item.xpPrice !== undefined; }
function isItemUnlocked(item, level) {
  if (myChance.wonItemIds.includes(item.id)) return true;
  if (isShopItem(item)) return myPurchases.includes(item.id);
  if (item.chanceOnly) return false;
  if (myChance.swappedAwayItemIds.includes(item.id)) return false;
  return item.unlockLevel <= level;
}
/* Shown in Inventory / House: things you own, plus level unlocks still to come (as padlocks).
   Shop and chance-only things you don't own stay hidden, and so do things you swapped away. */
function isItemShownInCollection(item, level) {
  if (isItemUnlocked(item, level)) return true;
  return item.unlockLevel !== undefined && item.unlockLevel > level && !myChance.swappedAwayItemIds.includes(item.id);
}
/* Powers switched on right now by the items in use (the server works these out the same way). */
function activePowers() { return currentProfile ? activePowersFor(currentProfile.equipped_items, myItemXp) : {}; }
function powerValue(powerId) { return activePowers()[powerId] || 0; }
function chanceFeaturesOn() { return currentProfile && currentProfile.chance_features !== false; }
/* Features being rolled out: true if the signed-in user has this one (see docs/voxie/FEATURES.md).
   The list comes with the profile, so a change shows next time they open the game. */
function featureOn(featureId) { return !!currentProfile && (currentProfile.features || []).includes(featureId); }
const ownsItemNow = itemId => { const item = getInventoryItem(itemId); return !!item && isItemUnlocked(item, unlockedLevel()); };
/* Only on an item just unlocked: its unlock level is your newest (highest) level, and you haven't decided yet. */
function canTakeAChance(item) {
  return chanceFeaturesOn() && item.unlockLevel !== undefined && item.unlockLevel === unlockedLevel() && ownsItemNow(item.id)
    && !myChance.triedItemIds.includes(item.id) && rarerPrizesFor(item, ownsItemNow).length > 0;
}
function renderProgress() {
  const level = currentLevel();
  renderStage(element("gameStage"), gameLook());
  element("levelNumber").textContent = level;
  const levelStart = pointsNeededForLevel(level), levelEnd = pointsNeededForLevel(level + 1);
  const filledCells = Math.floor(10 * (currentProgress.levelPoints - levelStart) / (levelEnd - levelStart));
  element("levelBar").innerHTML = Array.from({ length: 10 }, (_, index) => `<div class="cell${index < filledCells ? " on" : ""}"></div>`).join("");
  element("xpNumber").textContent = xpToSpend();
  const today = getTodayInUk();
  const lastSevenDays = Array.from({ length: 7 }, (_, index) => shiftDate(today, index - 6));
  element("weekStrip").innerHTML = lastSevenDays.map(day => `<div class="cell${currentProgress.daysPlayedDates.includes(day) ? " on" : ""}" "></div>`).join("");
  const tasksToGo = levelEnd - currentProgress.levelPoints;
  element("nextUnlock").textContent = `${tasksToGo} more task${tasksToGo === 1 ? "" : "s"} to level ${level + 1}.`;
  const resetsOnMiss = currentProfile.reset_streak_on_miss !== false;
  const streak = calculateStreak(currentProgress.daysPlayedDates, today, resetsOnMiss, powerValue("streak-shield"));
  renderPowersStrip();
  element("streakLabel").textContent = resetsOnMiss ? "Day streak" : "Days played";
  element("streakNumber").textContent = streak;
}

/* ---------- Powers strip on Home ---------- */
/* Free boxes waiting: one for every MILESTONE_EVERY_LEVELS levels the playing buddy has reached
   (each buddy opens its own, and what's inside is that buddy's). */
function unclaimedMilestones() {
  const claimed = myChance.claimedMilestones || [];
  return myBuddies.filter(buddy => buddy.id === currentProfile.active_buddy_id).flatMap(buddy => {
    const reached = [];
    for (let level = MILESTONE_EVERY_LEVELS; level <= buddyLevel(buddy.id); level += MILESTONE_EVERY_LEVELS)
      if (!claimed.includes(`${buddy.id}:${level}`)) reached.push({ buddyId: buddy.id, buddyName: buddy.petName, level });
    return reached;
  });
}
function renderPowersStrip() {
  const powers = activePowers(), entries = POWERS.filter(power => powers[power.id]);
  const treasureReady = powers["treasure-finder"] && !myChance.treasureClaimedThisWeek && chanceFeaturesOn();
  const milestones = unclaimedMilestones();
  element("powersStrip").hidden = !entries.length && !treasureReady && !milestones.length;
  element("powersLabel").hidden = !entries.length;
  element("powerChips").innerHTML = entries.map(power => `<span class="power-chip" title="${escapeHtml(power.describe(powers[power.id]))}">${power.label}</span>`).join("");
  element("claimTreasureButton").hidden = !treasureReady;
  const milestoneButton = element("claimMilestoneButton");
  milestoneButton.hidden = !milestones.length;
  if (milestones.length) setButtonText(milestoneButton, `🎁 Level ${milestones[0].level} reward: open your free box` + (milestones.length > 1 ? ` (${milestones.length} waiting)` : ""));
}
element("claimTreasureButton").onclick = () => openTreasureSheet();
element("claimMilestoneButton").onclick = () => { const next = unclaimedMilestones()[0]; if (next) openMilestoneSheet(next); };

/* ---------- Get the app (install to the home screen) ----------
   On Android / Chrome / Edge the browser offers an install prompt we can trigger. On iPhone and iPad there isn't one,
   so we show the steps instead. Needs a web app manifest + icons + service worker in the real app (Claude Code).
   The banner shows once, the first time someone logs in on this device, and never again (Get the app in Settings is
   there after that). Remembered per device. */
const INSTALL_BANNER_STORAGE_KEY = "voxie-install-banner-shown";
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt = event; });
window.addEventListener("appinstalled", () => { deferredInstallPrompt = null; element("installBanner").hidden = true; renderInstallSection(); });
function isInstalledApp() { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; }
function isAppleDevice() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
function installSteps() {
  return isAppleDevice()
    ? "Tap the Share button (the square with an arrow), then tap \"Add to Home Screen\"."
    : "Open your browser's menu (⋮ or ⋯), then tap \"Install app\" or \"Add to Home screen\".";
}
async function installApp(helpElementId) {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch (error) {}
    deferredInstallPrompt = null;
    return;
  }
  element(helpElementId).textContent = installSteps();
  element(helpElementId).hidden = false;
}
function readStorage(key) { try { return localStorage.getItem(key); } catch (error) { return null; } }
function writeStorage(key, value) { try { localStorage.setItem(key, value); } catch (error) {} }
let installBannerShownThisVisit = false;   // if the device can't remember (storage blocked), still only once per visit
function maybeShowInstallBanner() {
  const banner = element("installBanner");
  if (isInstalledApp()) { banner.hidden = true; return; }
  if (!banner.hidden || installBannerShownThisVisit) return;
  if (readStorage(INSTALL_BANNER_STORAGE_KEY) || readStorage("voxie-install-banner-last-shown")) return;   // the old key: already seen it
  writeStorage(INSTALL_BANNER_STORAGE_KEY, "yes");
  installBannerShownThisVisit = true;
  banner.querySelector(".install-text span").textContent = "Add it to your home screen. It opens straight into the game.";
  element("installBannerButton").hidden = false;
  element("installBannerLater").textContent = "Not now";
  banner.hidden = false;
}
element("installBannerButton").onclick = async () => {
  if (deferredInstallPrompt) { await installApp("installHelp"); element("installBanner").hidden = true; return; }
  element("installBanner").querySelector(".install-text span").textContent = installSteps();
  element("installBannerButton").hidden = true;
  element("installBannerLater").textContent = "Got it";
};
element("installBannerLater").onclick = () => { element("installBanner").hidden = true; };
function renderInstallSection() {
  element("installSection").hidden = isInstalledApp();
  element("installHelp").textContent = "";
}
element("installSettingsButton").onclick = () => installApp("installHelp");

/* ---------- Pet message box (Pokémon style) ----------
   Shown only when a task is ticked. Text types out, stays briefly, then slides away. Tap to skip. */
const PET_MESSAGE_LETTER_MS = 28;      // typing speed
const PET_MESSAGE_STAY_MS = 2200;      // how long it stays once fully typed
const TASK_DONE_LINES = [
  "Yum! Thanks, {name}!",
  "Nom nom nom…",
  "That hit the spot!",
  "Ooh, a snack! You're the best.",
  "Crunchy! Thanks, {name}.",
  "Wahoo! Nice one!",
  "More please! (Only joking.)",
  "We're getting stronger!"
];
let petMessageTimers = [];
function clearPetMessageTimers() { petMessageTimers.forEach(clearTimeout); petMessageTimers = []; }
function showPetMessage(text) {
  if (element("screenGame").hidden) return;
  clearPetMessageTimers();
  const box = element("petMessage"), textSpan = element("petMessageText");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element("petMessageName").textContent = petName();
  box.classList.remove("leaving");
  const stageBox = element("gameStage").getBoundingClientRect();
  box.classList.toggle("floating", stageBox.bottom > window.innerHeight || stageBox.bottom < 60);
  box.hidden = false;
  box.setAttribute("aria-label", `${petName()}: ${text}`);
  let shown = reduceMotion ? text.length : 0;
  const typeNextLetter = () => {
    textSpan.textContent = text.slice(0, shown);
    if (shown < text.length) { shown++; petMessageTimers.push(setTimeout(typeNextLetter, PET_MESSAGE_LETTER_MS)); }
    else petMessageTimers.push(setTimeout(hidePetMessage, PET_MESSAGE_STAY_MS));
  };
  typeNextLetter();
  box.onclick = () => { if (shown < text.length) { shown = text.length; clearPetMessageTimers(); typeNextLetter(); } else hidePetMessage(); };
}
function hidePetMessage() {
  clearPetMessageTimers();
  const box = element("petMessage");
  if (box.hidden) return;
  box.classList.add("leaving");
  petMessageTimers.push(setTimeout(() => { box.hidden = true; box.classList.remove("leaving"); }, 250));
}
function taskDoneLine(levelledUpTo) {
  if (levelledUpTo) return `Woah! We hit level ${levelledUpTo}!`;
  const line = TASK_DONE_LINES[Math.floor(Math.random() * TASK_DONE_LINES.length)];
  return line.replace("{name}", currentProfile.display_name || "friend");
}

function renderChores() {
  const area = element("choreArea");
  const setTaskRows = myChores.map(chore =>
    `<li class="chore"><label><input type="checkbox" id="chore-${chore.id}" data-chore-id="${chore.id}" ${choresDoneToday.includes(chore.id) ? "checked" : ""}><span>${escapeHtml(chore.title)}</span><span class="plus">+1</span></label></li>`);
  const todayId = getWeekDayIdInUk(getTodayInUk());
  const scheduledRows = myScheduledTasks.filter(task => task.daysOfWeek.includes(todayId)).flatMap(task =>
    Array.from({ length: task.timesPerDay }, (_, index) => {
      const occurrence = index + 1, done = scheduledDoneToday.some(record => record.scheduledTaskId === task.id && record.occurrence === occurrence);
      const tag = task.timesPerDay > 1 ? `${occurrence} of ${task.timesPerDay}` : "Every " + (task.daysOfWeek.length === 7 ? "day" : "week");
      return `<li class="chore"><label><input type="checkbox" id="scheduled-${task.id}-${occurrence}" data-scheduled-task-id="${task.id}" data-occurrence="${occurrence}" ${done ? "checked" : ""}><span>${escapeHtml(task.title)}</span><span class="yours">${tag}</span><span class="plus">+1</span></label></li>`;
    }));
  const ownTaskRows = myOwnTasksToday.map(task =>
    `<li class="chore chore-row"><label><input type="checkbox" id="own-${task.id}" data-own-task-id="${task.id}" ${task.done ? "checked" : ""}><span>${escapeHtml(task.title)}</span><span class="yours">Yours</span><span class="plus">+1</span></label>${task.done ? "" : `<button type="button" class="remove" data-remove-own-task="${task.id}" aria-label="Remove ${escapeHtml(task.title)}">✕</button>`}</li>`);
  const allRows = [...scheduledRows, ...setTaskRows, ...ownTaskRows];
  area.innerHTML = allRows.length ? `<ul class="chores">${allRows.join("")}</ul>`
    : `<div class="empty"><strong>No tasks yet</strong><span class="hint">Add something helpful you've done today below, or set up tasks that repeat in Config.</span></div>`;
  area.querySelectorAll("input[data-scheduled-task-id]").forEach(checkbox => checkbox.onchange = () => toggleScheduledTask(checkbox));
  area.querySelectorAll("input[data-chore-id]").forEach(checkbox => checkbox.onchange = () => toggleChore(checkbox));
  area.querySelectorAll("input[data-own-task-id]").forEach(checkbox => checkbox.onchange = () => toggleOwnTask(checkbox));
  area.querySelectorAll("[data-remove-own-task]").forEach(button => button.onclick = () => removeOwnTask(button.dataset.removeOwnTask));
  renderAddOwnTaskForm();
}
function tasksTodayCount() {
  const todayId = getWeekDayIdInUk(getTodayInUk());
  return myChores.length + myOwnTasksToday.length
    + myScheduledTasks.filter(task => task.daysOfWeek.includes(todayId)).reduce((total, task) => total + task.timesPerDay, 0);
}
function renderAddOwnTaskForm() {
  const left = Math.max(0, MAX_TASKS_PER_DAY - tasksTodayCount());
  element("addOwnTaskInput").disabled = element("addOwnTaskButton").disabled = left <= 0;
  element("addOwnTaskInput").closest(".field").hidden = left <= 0;
  element("addOwnTaskHint").textContent = left > 0
    ? `Add it, then tick it off for +1. You can add ${left} more today.`
    : `That's ${MAX_TASKS_PER_DAY} tasks today, the most you can have. Brilliant! You can add more tomorrow.`;
}
element("addOwnTaskForm").onsubmit = async event => {
  event.preventDefault();
  const title = element("addOwnTaskInput").value.trim();
  if (!title) { showFieldError("addOwnTaskInput", "addOwnTaskError", "Type what you did first."); return; }
  showFieldError("addOwnTaskInput", "addOwnTaskError", "");
  element("addOwnTaskButton").disabled = true;
  try {
    const task = await dataLayer.addMyOwnTask(title);
    myOwnTasksToday = [...myOwnTasksToday, task];
    element("addOwnTaskInput").value = "";
    hideSaveError();
    renderChores();
  } catch (error) {
    if (error.message === "daily-limit") { renderAddOwnTaskForm(); return; }
    showSaveError("Couldn't add that task. Check your internet and try again.", () => element("addOwnTaskForm").requestSubmit());
  }
  if (tasksTodayCount() < MAX_TASKS_PER_DAY) element("addOwnTaskButton").disabled = false;
};
async function toggleOwnTask(checkbox) {
  const taskId = checkbox.dataset.ownTaskId, nowDone = checkbox.checked;
  checkbox.disabled = true;
  try {
    await dataLayer.setMyOwnTaskDone(taskId, nowDone);
    myOwnTasksToday = myOwnTasksToday.map(task => task.id === taskId ? { ...task, done: nowDone } : task);
    await applyTaskTick(nowDone);
    hideSaveError();
    renderProgress();
    renderChores();
  } catch (error) {
    checkbox.checked = !nowDone;
    checkbox.disabled = false;
    showSaveError("Couldn't save that task. Check your internet and try again.", () => { checkbox.checked = nowDone; toggleOwnTask(checkbox); });
  }
}
async function toggleScheduledTask(checkbox) {
  const scheduledTaskId = checkbox.dataset.scheduledTaskId, occurrence = Number(checkbox.dataset.occurrence), nowDone = checkbox.checked;
  checkbox.disabled = true;
  try {
    if (nowDone) await dataLayer.markScheduledTaskDone(scheduledTaskId, occurrence); else await dataLayer.unmarkScheduledTaskDone(scheduledTaskId, occurrence);
    scheduledDoneToday = nowDone ? [...scheduledDoneToday, { scheduledTaskId, occurrence }]
      : scheduledDoneToday.filter(record => !(record.scheduledTaskId === scheduledTaskId && record.occurrence === occurrence));
    await applyTaskTick(nowDone);
    hideSaveError();
    renderProgress();
  } catch (error) {
    checkbox.checked = !nowDone;
    showSaveError("Couldn't save that task. Check your internet and try again.", () => { checkbox.checked = nowDone; toggleScheduledTask(checkbox); });
  }
  checkbox.disabled = false;
}
element("goToScheduledTasks").onclick = () => { openConfigScreen(); element("scheduledSection").scrollIntoView({ block: "start" }); };
async function removeOwnTask(taskId) {
  try {
    await dataLayer.removeMyOwnTask(taskId);
    myOwnTasksToday = myOwnTasksToday.filter(task => task.id !== taskId);
    hideSaveError();
    renderChores();
  } catch (error) {
    showSaveError("Couldn't remove that task. Check your internet and try again.", () => removeOwnTask(taskId));
  }
}
async function toggleChore(checkbox) {
  const choreId = checkbox.dataset.choreId, nowDone = checkbox.checked;
  checkbox.disabled = true;
  try {
    if (nowDone) await dataLayer.markChoreDone(choreId); else await dataLayer.unmarkChoreDone(choreId);
    choresDoneToday = nowDone ? [...choresDoneToday, choreId] : choresDoneToday.filter(id => id !== choreId);
    await applyTaskTick(nowDone);
    hideSaveError();
    renderProgress();
  } catch (error) {
    checkbox.checked = !nowDone;
    showSaveError("Couldn't save that task. Check your internet and try again.", () => { checkbox.checked = nowDone; toggleChore(checkbox); });
  }
  checkbox.disabled = false;
}

/* ---------- missions: up to 3 a day, each worth its difficulty in XP ---------- */
let openMissionId = null;
function difficultyPips(difficulty) {
  return `<span class="pips" aria-label="Difficulty ${difficulty} of 5">${Array.from({ length: 5 }, (_, index) => `<span class="${index < difficulty ? "on" : ""}"></span>`).join("")}</span>`;
}
/* Hint / Think again used on each open mission (cleared once it's saved). */
let missionHelp = {};
const helpFor = missionId => (missionHelp[missionId] = missionHelp[missionId] || { usedHint: false, usedThinkAgain: false, crossedOut: [] });
const hintsLeftToday = () => powerValue("hint") - (currentProgress.hintsUsedToday || 0) - Object.values(missionHelp).filter(help => help.usedHint).length;
const thinkAgainsLeftToday = () => powerValue("think-again") - (currentProgress.thinkAgainsUsedToday || 0) - Object.values(missionHelp).filter(help => help.usedThinkAgain).length;
function renderMissions() {
  stopMissionTimer();
  const area = element("missionArea"), missions = pickTodaysMissions(currentProfile.id, {
    age: ageFromBirthMonth(currentProfile.birth_month, currentProfile.birth_year),
    lastDoneOn: currentProgress.missionsLastDoneOn || {}, bonusMissions: powerValue("bonus-mission") });
  const doneCount = currentProgress.missionsDoneToday.length, brainBoost = powerValue("brain-boost");
  area.innerHTML = `<h2>Today's missions</h2>
    <p class="hint">${doneCount} of ${missions.length} done. Harder missions are worth more XP if you get them right, and you always get +${XP_FOR_TRYING} for trying.${currentProfile.timed_missions ? " Timed missions are switched on." : " No rush. Take as long as you like."}</p>
    <div class="missions">${missions.map(mission => {
      const doneRecord = currentProgress.missionsDoneToday.find(record => record.missionId === mission.id), done = !!doneRecord, isOpen = openMissionId === mission.id && !done;
      return `<div class="mission${done ? " completed" : ""}" data-mission="${mission.id}">
        <div class="mission-head">
          <div class="left"><span class="mtype">${mission.isBonus ? "✨ Bonus · " : ""}${mission.kind}</span>${difficultyPips(mission.difficulty)}</div>
          <span class="xp-tag">${done ? `✓ +${doneRecord.xpAwarded} XP` : isChallenge(mission) ? `+${mission.difficulty} XP` : `Up to +${mission.difficulty + brainBoost} XP`}</span>
        </div>
        ${done ? `<p class="hint">${isChallenge(mission) ? escapeHtml(mission.doneMessage) : doneRecord.xpAwarded > XP_FOR_TRYING ? "Done. Nice work!" : "Done. Thanks for having a go!"}</p>`
          : isOpen ? (isChallenge(mission) ? challengeBodyHtml(mission) : missionBodyHtml(mission))
          : `<button type="button" class="btn small" data-start-mission="${mission.id}">${currentProfile.timed_missions && !isChallenge(mission) ? "Start the clock" : "Start"}</button>`}
      </div>`;
    }).join("")}</div>`;
  area.querySelectorAll("[data-start-mission]").forEach(button => button.onclick = () => { openMissionId = button.dataset.startMission; renderMissions(); });
  const openMission = missions.find(mission => mission.id === openMissionId);
  if (openMission && !currentProgress.missionsDoneToday.some(record => record.missionId === openMission.id)) {
    if (isChallenge(openMission)) wireChallenge(openMission); else wireMissionChoices(openMission);
  }
}
/* Feel good: a small real-life side quest, done on trust. No timer, no right answer, and Hint / Think again don't apply. */
function challengeBodyHtml(mission) {
  return `<p class="q">${escapeHtml(mission.question)}</p>${mission.tip ? `<p class="hint">${escapeHtml(mission.tip)}</p>` : ""}
    <div class="btnrow"><button type="button" class="btn" data-collect>I did it!</button><button type="button" class="btn ghost" data-not-now>Not right now</button></div>`;
}
function wireChallenge(mission) {
  const card = element("missionArea").querySelector(`[data-mission="${mission.id}"]`);
  card.querySelector("[data-collect]").onclick = () => collectMissionXp(mission, null);
  // It stays on today's list, so they can come back to it later in the day.
  card.querySelector("[data-not-now]").onclick = () => { openMissionId = null; renderMissions(); };
}
function missionBodyHtml(mission) {
  const isScenario = !!mission.wordsToSay;
  const timer = currentProfile.timed_missions
    ? `<div class="mission-timer" role="timer" aria-label="Time left to read and answer"><span class="label">Time</span><div class="timer-track"><div class="timer-fill"></div></div></div>` : "";
  const help = helpFor(mission.id);
  const hintButton = hintsLeftToday() > 0 && !help.usedHint ? `<div class="mission-tools"><button type="button" class="btn small ghost" data-use-hint>✨ Hint (${hintsLeftToday()} left today)</button></div>` : "";
  return `${timer}<p class="q">${escapeHtml(mission.question)}</p>
    <div class="choices">${mission.options.map((option, index) => `<button type="button" class="choice${help.crossedOut.includes(index) ? " crossed" : ""}" data-choice-index="${index}" ${help.crossedOut.includes(index) ? "disabled" : ""}>${escapeHtml(isScenario ? option.text : option)}</button>`).join("")}</div>
    ${hintButton}
    <div class="mission-feedback"></div>`;
}
let missionTimerId = null;
function stopMissionTimer() { if (missionTimerId) { clearInterval(missionTimerId); missionTimerId = null; } }
function startMissionTimer(mission, card) {
  stopMissionTimer();
  const totalMs = missionTimeLimitSeconds(mission, powerValue("extra-time")) * 1000, endsAt = Date.now() + totalMs;
  const fill = card.querySelector(".timer-fill");
  missionTimerId = setInterval(() => {
    const msLeft = Math.max(0, endsAt - Date.now());
    fill.style.width = (100 * msLeft / totalMs) + "%";
    fill.classList.toggle("low", msLeft <= 3000);
    if (msLeft === 0) { stopMissionTimer(); showTimesUp(mission, card); }
  }, 100);
}
function showTimesUp(mission, card) {
  card.querySelectorAll(".choice").forEach(button => button.disabled = true);
  card.querySelector(".mission-feedback").innerHTML = `<div class="feedback"><p class="times-up">${escapeHtml(pickTimesUpLine())}</p>
    <p class="hint">You still get +${XP_FOR_TRYING} XP for trying. Answer in time and get it right for +${mission.difficulty}.</p>
    <button type="button" class="btn" data-collect>Collect +${XP_FOR_TRYING} XP</button></div>`;
  card.querySelector("[data-collect]").onclick = () => collectMissionXp(mission, TIMED_OUT);
}
function wireMissionChoices(mission, { restartClock = true } = {}) {
  const card = element("missionArea").querySelector(`[data-mission="${mission.id}"]`), isScenario = !!mission.wordsToSay, help = helpFor(mission.id);
  if (restartClock && currentProfile.timed_missions && !card.querySelector(".feedback")) startMissionTimer(mission, card);
  // Hint power: cross out one wrong answer.
  const hintButton = card.querySelector("[data-use-hint]");
  if (hintButton) hintButton.onclick = () => {
    const wrongOnes = mission.options.map((option, index) => index).filter(index => !isRightAnswer(mission, index) && !help.crossedOut.includes(index));
    if (!wrongOnes.length) return;
    help.usedHint = true;
    help.crossedOut.push(wrongOnes[Math.floor(Math.random() * wrongOnes.length)]);
    const crossed = card.querySelector(`[data-choice-index="${help.crossedOut[help.crossedOut.length - 1]}"]`);
    crossed.classList.add("crossed"); crossed.disabled = true;
    hintButton.parentElement.remove();
  };
  card.querySelectorAll(".choice:not(.crossed)").forEach(button => button.onclick = () => {
    stopMissionTimer();
    const choiceIndex = Number(button.dataset.choiceIndex);
    if (card.querySelector("[data-use-hint]")) card.querySelector("[data-use-hint]").parentElement.remove();
    card.querySelectorAll(".choice").forEach(other => { other.disabled = true; other.classList.toggle("picked", other === button); });
    let feedbackHtml;
    if (isScenario) {
      const option = mission.options[choiceIndex];
      feedbackHtml = `<h3>${option.heading}</h3><p>${option.response}</p><p>${option.whyItsHard}</p><p class="words">${mission.wordsToSay}</p>`;
    } else {
      feedbackHtml = `<h3>${choiceIndex === mission.correctIndex ? "Nice one!" : "Good guess!"}</h3><p>${mission.explanation}</p>`;
    }
    const right = isRightAnswer(mission, choiceIndex), brainBoost = right ? powerValue("brain-boost") : 0;
    const xpEarned = xpForAnswer(mission, choiceIndex, brainBoost);
    const boostNote = brainBoost ? `<p class="power-note">✨ Brain boost: +${brainBoost} XP</p>` : "";
    // Think again power: after a wrong answer, have another go instead of collecting.
    // Only offered if at least 2 answers would still be left to pick from (so Hint + Think again can't just give it away).
    const answersLeftAfter = mission.options.length - help.crossedOut.length - 1;
    const canThinkAgain = !right && !help.usedThinkAgain && thinkAgainsLeftToday() > 0 && answersLeftAfter >= 2;
    const xpNote = right ? "" : `<p class="hint">You get +${xpEarned} XP for trying. Get it right for +${mission.difficulty + powerValue("brain-boost")}.</p>`;
    const showFullFeedback = () => {
      card.querySelector(".mission-feedback").innerHTML = `<div class="feedback">${feedbackHtml}${boostNote}${xpNote}
        <button type="button" class="btn" data-collect>Collect +${xpEarned} XP</button></div>`;
      card.querySelector("[data-collect]").onclick = () => collectMissionXp(mission, choiceIndex);
    };
    if (!canThinkAgain) { showFullFeedback(); return; }
    // Think again is offered BEFORE the answer is shown, so it's a real second go.
    card.querySelector(".mission-feedback").innerHTML = `<div class="feedback"><h3>Not quite!</h3><p>Want to think about it again?</p>
      <button type="button" class="btn chance-gold" data-think-again>✨ Think again (${thinkAgainsLeftToday()} left today)</button>
      <button type="button" class="btn ghost" data-show-answer>No thanks, show me</button></div>`;
    card.querySelector("[data-show-answer]").onclick = showFullFeedback;
    const thinkAgain = card.querySelector("[data-think-again]");
    if (thinkAgain) thinkAgain.onclick = () => {
      help.usedThinkAgain = true;
      help.crossedOut.push(choiceIndex);   // the wrong one they picked can't be picked again
      card.querySelector(".mission-feedback").innerHTML = "";
      card.querySelectorAll(".choice").forEach(other => {
        other.classList.remove("picked");
        const crossed = help.crossedOut.includes(Number(other.dataset.choiceIndex));
        other.classList.toggle("crossed", crossed); other.disabled = crossed;
      });
      wireMissionChoices(mission, { restartClock: false });
    };
  });
}
async function collectMissionXp(mission, choiceIndex) {
  const button = element("missionArea").querySelector("[data-collect]");
  button.disabled = true;
  try {
    const help = helpFor(mission.id);
    const { xpAwarded: xpEarned } = await dataLayer.saveMissionCompletion(mission.id, choiceIndex, { usedHint: help.usedHint, usedThinkAgain: help.usedThinkAgain, didIt: isChallenge(mission) });
    const today = getTodayInUk();
    if (currentProgress.missionsDoneToday.some(record => record.missionId === mission.id)) { openMissionId = null; renderMissions(); return; } // already counted
    if (help.usedHint) currentProgress.hintsUsedToday = (currentProgress.hintsUsedToday || 0) + 1;
    if (help.usedThinkAgain) currentProgress.thinkAgainsUsedToday = (currentProgress.thinkAgainsUsedToday || 0) + 1;
    delete missionHelp[mission.id];
    currentProgress.xpEarned += xpEarned;
    currentProgress.missionsDoneToday = [...currentProgress.missionsDoneToday, { missionId: mission.id, xpAwarded: xpEarned }];
    if (!currentProgress.daysPlayedDates.includes(today)) { currentProgress.daysPlayedDates.push(today); currentProgress.daysPlayedTotal++; }
    openMissionId = null;
    hideSaveError();
    renderProgress();
    renderMissions();
  } catch (error) {
    button.disabled = false;
    if (error.message === "no-power") {
      // The power was taken off since it was used: this one counts without it.
      const help = helpFor(mission.id); help.usedHint = false; help.usedThinkAgain = false;
      showSaveError("That power isn't switched on any more, so this mission counts without it. Tap Collect again.", null);
      return;
    }
    if (error.message === "daily-limit") { showSaveError("That's all your missions for today. More tomorrow!", null); openMissionId = null; renderMissions(); return; }
    if (error.message === "not-for-age") {
      // Their grown-up has changed their birth month: pick up the new age and today's missions with it.
      showSaveError("Your missions have changed. Pick one from the new list.", null);
      openMissionId = null;
      dataLayer.getSignedInProfile().then(fresh => { takeGrownUpSettings(fresh); renderMissions(); }).catch(() => renderMissions());
      return;
    }
    showSaveError("Couldn't save your mission. Check your internet and try again.", () => collectMissionXp(mission, choiceIndex));
  }
}

element("levelUpClose").onclick = hideLevelUp;
element("levelUpGo").onclick = () => {
  const target = element("levelUpGo").dataset.target;
  hideLevelUp();
  if (target === "customise") openBuddies(); else if (target === "locations") openLocations(); else if (target === "house") openHouse(); else openInventory(target);
};

/* ---------- sortable collections (Inventory and House share this) ----------
   A browser can show its items by type (its own sections) or by rarity. */
function createCollectionBrowser({ name, types, typeOf, includes, render }) {
  return { name, types, typeOf, includes, render, mode: "type", selectedType: types[0].id, selectedRarity: RARITIES[0].id };
}
function browserGroups(browser) {
  return browser.mode === "type"
    ? browser.types.map(type => ({ id: type.id, label: type.label, hint: type.hint, gem: null }))
    : RARITIES.map(rarity => ({ id: rarity.id, label: rarity.shortLabel, hint: `${rarity.label} things you can collect.`, gem: rarity.colour }));
}
function browserSelectedGroup(browser) {
  const groupId = browser.mode === "type" ? browser.selectedType : browser.selectedRarity;
  return browserGroups(browser).find(group => group.id === groupId);
}
function browserSelect(browser, groupId) { if (browser.mode === "type") browser.selectedType = groupId; else browser.selectedRarity = groupId; }
function browserItems(browser) {
  const group = browserSelectedGroup(browser);
  const level = unlockedLevel();
  const inGroup = INVENTORY_ITEMS.filter(item => browser.includes(item) && isItemShownInCollection(item, level)
      && (browser.mode === "type" ? browser.typeOf(item) === group.id : item.rarity === group.id))
    .sort((first, second) => (first.unlockLevel ?? 0) - (second.unlockLevel ?? 0));
  // Everything you own, then just ONE padlock: the next thing this section unlocks.
  const owned = inGroup.filter(item => isItemUnlocked(item, level));
  const nextLocked = inGroup.find(item => !isItemUnlocked(item, level));
  return nextLocked ? [...owned, nextLocked] : owned;
}
/* Buttons are rebuilt only when switching between Type and Rarity, so the slider can glide between them. */
function renderBrowserControls(browser) {
  element(`${browser.name}SortByType`).setAttribute("aria-pressed", String(browser.mode === "type"));
  element(`${browser.name}SortByRarity`).setAttribute("aria-pressed", String(browser.mode === "rarity"));
  element(`${browser.name}SortBySeasonPass`).setAttribute("aria-pressed", String(browser.mode === "seasonPass"));
  /* Season pass has no sections yet, so the section bar is hidden and the caller shows "coming soon". */
  element(`${browser.name}Subtabs`).hidden = browser.mode === "seasonPass";
  if (browser.mode === "seasonPass") return null;
  const subtabs = element(`${browser.name}Subtabs`), groups = browserGroups(browser), selected = browserSelectedGroup(browser);
  if (subtabs.dataset.mode !== browser.mode) {
    subtabs.dataset.mode = browser.mode;
    subtabs.querySelectorAll(".subtab").forEach(button => button.remove());
    subtabs.style.setProperty("--tab-count", groups.length);
    subtabs.insertAdjacentHTML("beforeend", groups.map(group =>
      `<button type="button" class="subtab" role="tab" data-group="${group.id}">${group.gem ? `<span class="gem" style="background:${group.gem}"></span>` : ""}${group.label}</button>`).join(""));
    subtabs.querySelectorAll(".subtab").forEach(button => button.onclick = () => { browserSelect(browser, button.dataset.group); browser.render(); });
  }
  subtabs.querySelectorAll(".subtab").forEach(button => button.setAttribute("aria-selected", String(button.dataset.group === selected.id)));
  subtabs.querySelector(".subtab-slider").style.transform = `translateX(${groups.findIndex(group => group.id === selected.id) * 100}%)`;
  return selected;
}
function wireBrowser(browser, gridId) {
  element(`${browser.name}SortByType`).onclick = () => { browser.mode = "type"; browser.render(); };
  element(`${browser.name}SortByRarity`).onclick = () => { browser.mode = "rarity"; browser.render(); };
  element(`${browser.name}SortBySeasonPass`).onclick = () => { browser.mode = "seasonPass"; browser.render(); };
  let startX = null, startY = null;
  const grid = element(gridId);
  grid.style.touchAction = "pan-y";
  grid.addEventListener("touchstart", event => { startX = event.touches[0].clientX; startY = event.touches[0].clientY; }, { passive: true });
  grid.addEventListener("touchend", event => {
    if (startX === null) return;
    const deltaX = event.changedTouches[0].clientX - startX, deltaY = event.changedTouches[0].clientY - startY;
    startX = null;
    if (browser.mode === "seasonPass") return;
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    const groups = browserGroups(browser), index = groups.findIndex(group => group.id === browserSelectedGroup(browser).id);
    const nextIndex = Math.min(groups.length - 1, Math.max(0, index + (deltaX < 0 ? 1 : -1)));
    if (nextIndex !== index) { browserSelect(browser, groups[nextIndex].id); browser.render(); }
  });
}

/* ---------- inventory ---------- */
const inventoryBrowser = createCollectionBrowser({
  name: "inventory", types: INVENTORY_CATEGORIES, typeOf: item => item.category, includes: item => item.category !== "house", render: () => renderInventory()
});
wireBrowser(inventoryBrowser, "inventoryGrid");
function openInventory(categoryId) {
  if (categoryId) { inventoryBrowser.mode = "type"; inventoryBrowser.selectedType = categoryId; }
  showScreen("screenInventory");
  renderInventory();
}
function renderInventory() {
  const level = unlockedLevel(), equipped = currentProfile.equipped_items, look = lookFromProfile(currentProfile);
  renderStage(element("inventoryStage"), gameLook());
  const group = renderBrowserControls(inventoryBrowser);
  if (!group) { element("inventorySummary").textContent = ""; element("inventoryGrid").innerHTML = seasonPassComingSoonHtml(); return; }
  const items = browserItems(inventoryBrowser);
  element("inventorySummary").textContent = group.hint.replace("{pet}", petName());
  const grid = element("inventoryGrid");
  grid.innerHTML = items.length ? items.map(item => {
    const unlocked = isItemUnlocked(item, level), inUse = equipped.includes(item.id);
    if (!unlocked) return lockedCardHtml("item", item.unlockLevel);
    const useWord = inUse ? inUseWord(item) : "Tap for details";
    const thumbSize = item.category === "pets" ? 16 : 112;
    return `<button type="button" class="item" data-item="${item.id}" aria-pressed="${inUse}">
      <canvas width="${thumbSize}" height="${thumbSize}"></canvas><strong>${item.label}</strong>
      ${rarityBadgeHtml(item.rarity)}
      ${cardPowersHtml(item)}
      <span class="status">${useWord}</span></button>`;
  }).join("") : emptyCollectionHtml();
  grid.querySelectorAll(".item[data-item]").forEach(button => {
    const itemId = button.dataset.item;
    if (isCompanionPet(itemId)) drawCompanionThumbnail(button.querySelector("canvas"), itemId, getThemeColour(look.themeColour));
    else drawPet(button.querySelector("canvas"), look.petType, { equipped: [itemId], petLook: look.petLook, fitTight: true });
    button.onclick = () => openItemDetails(itemId);
  });
}
/* An item's powers as rows (for the Shop and New item pop-ups): tier, what it does, and the item XP it needs. */
function powersListHtml(item) {
  const powers = itemPowers(item);
  if (!powers.length) return `<li><span class="hint">This item has no powers.</span></li>`;
  return powers.map(entry => `<li><strong>${entry.tierLabel}</strong>
    <span class="power-text"><b>${entry.power.label}</b><span>${escapeHtml(entry.power.describe(entry.value))}</span></span>
    <span class="hint power-state">${(myItemXp[item.id] || 0) >= entry.xpNeeded ? "Unlocked" : lockedXpHtml(entry.xpNeeded)}</span></li>`).join("");
}
/* A padlock and the item XP a power needs. */
function lockedXpHtml(xpNeeded) { return `<span class="locked-xp" aria-label="Locked. Needs ${xpNeeded} item XP">${LOCK_ICON}${xpNeeded} XP</span>`; }
/* Small list of an item's powers for its card: what they are and the item XP each needs (✓ when reached). */
function cardPowersHtml(item) {
  const powers = itemPowers(item);
  if (!powers.length) return "";
  const itemXp = myItemXp[item.id] || 0;
  return `<span class="card-powers">${powers.map(entry => itemXp >= entry.xpNeeded
    ? `<span class="reached">✓ ${entry.power.label}</span>` : `<span>✨ ${entry.power.label} · <b>${entry.xpNeeded}</b> XP</span>`).join("")}</span>`;
}
function inUseWord(item) { return item.slot === "hand" ? "Holding" : item.category === "pets" ? "Hanging out" : "Wearing"; }
function useButtonLabel(item, inUse) {
  if (item.slot === "hand") return inUse ? "Put away" : "Hold it";
  if (item.category === "pets") return inUse ? "Send home" : "Bring along";
  return inUse ? "Take off" : "Wear it";
}
let openItemId = null, itemSheetReturnFocus = null;
function openItemDetails(itemId) {
  openItemId = itemId;
  colourPanelOpen = false;
  addXpPanelOpen = false;
  itemSheetReturnFocus = document.activeElement;
  renderItemDetails();
  element("itemSheet").hidden = false;
  element("itemSheetClose").focus();
}
function closeItemDetails() {
  element("itemSheet").hidden = true;
  openItemId = null;
  if (itemSheetReturnFocus && itemSheetReturnFocus.isConnected) itemSheetReturnFocus.focus();
}
function renderItemDetails() {
  if (!openItemId) return;
  const item = getInventoryItem(openItemId), look = lookFromProfile(currentProfile), inUse = currentProfile.equipped_items.includes(item.id);
  const rarity = getRarity(item.rarity), itemXp = myItemXp[item.id] || 0, ability = abilityLevelFor(itemXp);
  const category = INVENTORY_CATEGORIES.find(candidate => candidate.id === item.category);
  const preview = element("itemSheetPreview");
  if (isCompanionPet(item.id)) { preview.width = preview.height = 16; drawCompanionThumbnail(preview, item.id, getThemeColour(look.themeColour)); }
  else { preview.width = preview.height = 112; drawPet(preview, look.petType, { equipped: [item.id], petLook: look.petLook, fitTight: true }); }
  element("itemSheetName").textContent = item.label;
  element("itemSheetRarity").innerHTML = rarityBadgeHtml(item.rarity);
  element("itemSheetType").textContent = `${category ? category.label : ""}${inUse ? ` · ${inUseWord(item)}` : ""}`;
  const boxChance = canBeWonByChance(item) ? boxChanceFromFullBox(item.id) : 0;
  element("itemStatRarity").innerHTML = `<span class="swatch" style="background:${rarity.colour}"></span>${rarity.label}`
    + (boxChance ? `<span class="box-chance">${chanceText(boxChance)} in a box</span>` : "");
  const swatchColour = item.colour || hsl(getThemeColour(look.themeColour).hue, getThemeColour(look.themeColour).saturation, 55);
  // Colour: shows the chosen colour, and a padlock with the level it can be changed at (or a Change button).
  const chosenColour = ITEM_COLOUR_OPTIONS.find(option => option.id === (myItemColours[item.id] || "original"));
  const recolourLevel = recolourUnlockLevel(item, gotAtLevelFor(item, myGotAtLevels)), colourLocked = unlockedLevel() < recolourLevel;
  const shownSwatch = chosenColour.hue !== undefined ? recolourHex(swatchColour, chosenColour.id) : swatchColour;
  element("itemStatColour").innerHTML = `<span class="swatch" style="background:${shownSwatch}"></span>${chosenColour.hue !== undefined ? chosenColour.label : item.colourName || "Mixed"}`
    + (colourLocked ? `<span class="mini-lock" title="Change colour at level ${recolourLevel}" aria-label="Changing colour unlocks at level ${recolourLevel}">${LOCK_ICON}<span>Lv ${recolourLevel}</span></span>`
      : item.category === "house" ? "" : `<button type="button" class="mini-change" id="itemChangeColourButton">Change</button>`);
  if (!colourLocked && element("itemChangeColourButton")) element("itemChangeColourButton").onclick = () => { colourPanelOpen = !colourPanelOpen; renderColourPanel(item); };
  renderColourPanel(item);
  element("itemStatXp").textContent = itemXp;
  element("itemStatAbility").textContent = ability.label;
  const abilityIndex = ABILITY_LEVELS.indexOf(ability), nextAbility = ABILITY_LEVELS[abilityIndex + 1];
  element("itemAbilityNext").textContent = !itemPowers(item).length ? ""
    : itemXp >= usefulXpFor(item) ? "All this item's powers are unlocked."
    : nextAbility ? `${nextAbility.xpNeeded - itemXp} more XP to reach ${nextAbility.label}. Powers only work while you're using the item.` : "";
  // The item's powers: what each unlocks, and whether it's working (reached AND the item is in use).
  const powers = itemPowers(item);
  element("itemAbilityList").innerHTML = powers.length ? powers.map(entry => {
    const reached = itemXp >= entry.xpNeeded, working = reached && inUse && item.category !== "house";
    return `<li class="${reached ? "reached" : ""}${working ? " active" : ""}"><strong>${entry.tierLabel}</strong>
      <span class="power-text"><b>${working ? "✨ " : ""}${entry.power.label}</b><span>${escapeHtml(entry.power.describe(entry.value))}</span></span>
      <span class="hint power-state">${working ? "On" : reached ? `${useButtonLabel(item, false)} to use` : lockedXpHtml(entry.xpNeeded)}</span></li>`;
  }).join("") : `<li><span class="hint">This item has no powers.</span></li>`;
  element("itemSheetUse").textContent = useButtonLabel(item, inUse);
  renderAddXp();
}

/* ---------- Change an item's colour (inside the item pop-up) ---------- */
let colourPanelOpen = false;
function renderColourPanel(item) {
  const panel = element("itemColourPanel");
  panel.hidden = !colourPanelOpen;
  if (!colourPanelOpen) return;
  const current = myItemColours[item.id] || "original", base = item.colour || "#9AA3AD";
  panel.innerHTML = `<span class="label">Pick a colour</span><div class="picker colours item-colours">${ITEM_COLOUR_OPTIONS.map(option =>
    `<button type="button" class="tile" data-item-colour="${option.id}" aria-pressed="${option.id === current}" title="${option.label}">
      <span class="chip" style="background:${option.hue === undefined ? base : recolourHex(base, option.id)}"></span><span class="visually-hidden">${option.label}</span></button>`).join("")}</div>`;
  panel.querySelectorAll("[data-item-colour]").forEach(button => button.onclick = () => saveItemColour(item.id, button.dataset.itemColour));
}
async function saveItemColour(itemId, colourId) {
  const previous = myItemColours[itemId];
  myItemColours = { ...myItemColours };
  if (colourId === "original") delete myItemColours[itemId]; else myItemColours[itemId] = colourId;
  if (openItemId === itemId) renderItemDetails();
  rerenderCurrentScreen();
  try {
    await dataLayer.setItemColour(itemId, colourId);
    hideSaveError();
  } catch (error) {
    myItemColours = { ...myItemColours };
    if (previous) myItemColours[itemId] = previous; else delete myItemColours[itemId];
    if (openItemId === itemId) renderItemDetails();
    rerenderCurrentScreen();
    showSaveError(error.message === "locked" ? "You can't change this colour yet." : "Couldn't change the colour. Check your internet and try again.", error.message === "locked" ? null : () => saveItemColour(itemId, colourId));
  }
}

/* ---------- Add XP to an item (inside the item pop-up) ---------- */
let addXpAmount = 1, addXpPanelOpen = false, addXpSaving = false;
const TOP_ABILITY_XP = ABILITY_LEVELS[ABILITY_LEVELS.length - 1].xpNeeded;
/* Most XP that can go in right now: what the child has, but never past the top ability level (so XP isn't wasted). */
function maxXpForOpenItem() {
  const itemXp = myItemXp[openItemId] || 0;
  return Math.max(0, Math.min(xpToSpend(), usefulXpFor(getInventoryItem(openItemId)) - itemXp));
}
function renderAddXp() {
  if (!openItemId) return;
  const itemXp = myItemXp[openItemId] || 0, spare = xpToSpend(), maxAmount = maxXpForOpenItem();
  const addButton = element("itemSheetAddXp"), hint = element("itemAddXpHint");
  addButton.disabled = maxAmount === 0;
  const item = getInventoryItem(openItemId);
  hint.textContent = !itemPowers(item).length ? "This item has no powers to unlock." : itemXp >= usefulXpFor(item) ? "This item is maxed out." : spare === 0 ? "No XP to spend yet. Do missions on Home to earn some." : "";
  hint.hidden = !hint.textContent;
  if (maxAmount === 0) addXpPanelOpen = false;
  element("itemAddXpPanel").hidden = !addXpPanelOpen;
  element("itemSheetButtons").hidden = addXpPanelOpen;
  if (!addXpPanelOpen) return;
  addXpAmount = Math.min(Math.max(1, addXpAmount), maxAmount);
  element("itemAddXpAvailable").textContent = `You have ${spare} XP to spend`;
  element("itemAddXpAmount").textContent = addXpAmount;
  element("itemAddXpLess").disabled = addXpSaving || addXpAmount <= 1;
  element("itemAddXpMore").disabled = addXpSaving || addXpAmount >= maxAmount;
  element("itemAddXpMax").disabled = addXpSaving || addXpAmount >= maxAmount;
  const after = itemXp + addXpAmount, abilityAfter = abilityLevelFor(after), abilityNow = abilityLevelFor(itemXp);
  element("itemAddXpPreview").textContent = `Item XP ${itemXp} → ${after}` + (abilityAfter !== abilityNow ? ` · reaches ${abilityAfter.label}!` : "");
  setButtonText(element("itemAddXpConfirm"), addXpSaving ? "Adding…" : `Add ${addXpAmount} XP`);
  element("itemAddXpConfirm").disabled = addXpSaving;
  element("itemAddXpCancel").disabled = addXpSaving;
}
element("itemSheetAddXp").onclick = () => { addXpPanelOpen = true; addXpAmount = 1; renderAddXp(); element("itemAddXpMore").focus(); };
element("itemAddXpCancel").onclick = () => { addXpPanelOpen = false; renderAddXp(); element("itemSheetAddXp").focus(); };
element("itemAddXpLess").onclick = () => { addXpAmount--; renderAddXp(); };
element("itemAddXpMore").onclick = () => { addXpAmount++; renderAddXp(); };
element("itemAddXpMax").onclick = () => { addXpAmount = maxXpForOpenItem(); renderAddXp(); };
element("itemAddXpConfirm").onclick = () => addXpToOpenItem();
async function addXpToOpenItem(itemId = openItemId, amount = addXpAmount) {
  addXpSaving = true; if (openItemId === itemId) renderAddXp();
  try {
    myItemXp[itemId] = await dataLayer.addXpToItem(itemId, amount);
    currentProgress.xpSpentOnItems += amount;
    hideSaveError();
    addXpPanelOpen = false;
  } catch (error) {
    showSaveError(error.message === "not-enough-xp" ? "You don't have that much XP." : "Couldn't add the XP. Check your internet and try again.", error.message === "not-enough-xp" ? null : () => addXpToOpenItem(itemId, amount));
  }
  addXpSaving = false;
  if (openItemId === itemId) renderItemDetails();
  renderProgress();
}
element("itemSheetClose").onclick = closeItemDetails;
element("itemSheet").addEventListener("click", event => { if (event.target === element("itemSheet")) closeItemDetails(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !element("itemSheet").hidden) closeItemDetails(); });
/* Stays open after wearing or taking off, so the child can see the change; they close it themselves. */
element("itemSheetUse").onclick = async () => {
  const itemId = openItemId;
  await toggleInventoryItem(itemId);
  if (openItemId === itemId) renderItemDetails();
};

/* Placeholder until season pass items exist. Used by Inventory, House and Locations. */
function seasonPassComingSoonHtml() {
  return `<div class="empty season-pass-soon"><strong>Season pass</strong><span class="badge-soon">Coming soon</span></div>`;
}
function emptyCollectionHtml() {
  return `<div class="empty" style="grid-column:1/-1"><strong>Nothing here yet</strong><span class="hint">Keep levelling up. New things get added all the time.</span></div>`;
}
/* Locked things stay a surprise: just a padlock and the level they unlock at. */
function lockedCardHtml(cardClass, unlockLevel) {
  return `<div class="${cardClass} locked" role="img" aria-label="Locked. Unlocks at level ${unlockLevel}">${LOCK_ICON}<strong>Level ${unlockLevel}</strong><span class="status">Unlocks at this level</span></div>`;
}
function rerenderCurrentScreen() {
  if (!element("screenShop").hidden) renderShop();
  if (!element("screenInventory").hidden) renderInventory();
  if (!element("screenHouse").hidden) renderHouse();
  if (!element("screenLocations").hidden) renderLocations();
  if (!element("screenBuddies").hidden) renderBuddies();
}
async function toggleInventoryItem(itemId) {
  const item = getInventoryItem(itemId), previous = currentProfile.equipped_items;
  let next = previous.filter(id => id !== itemId);
  if (!previous.includes(itemId)) { next = next.filter(id => (getInventoryItem(id) || {}).slot !== item.slot); next.push(itemId); }
  currentProfile.equipped_items = next;
  rerenderCurrentScreen();
  try {
    currentProfile = await dataLayer.updateEquippedItems(next);
    hideSaveError();
  } catch (error) {
    currentProfile.equipped_items = previous;
    rerenderCurrentScreen();
    showSaveError("Couldn't save that. Check your internet and try again.", () => toggleInventoryItem(itemId));
  }
}

/* ---------- Buddies: your pets, rebirth, and customising the one that's playing ---------- */
let myBuddies = [], rebirthPanelOpen = false, rebirthPetType = null;
async function openBuddies() {
  showScreen("screenBuddies");
  rebirthPanelOpen = false;
  element("customiseStatus").textContent = "Changes save straight away";
  renderBuddies();
}
function renderBuddies() { renderBuddyList(); renderCustomise(); }
function renderBuddyList() {
  const activeLook = lookFromProfile(currentProfile), theme = getThemeColour(activeLook.themeColour);
  const notCollected = petTypesNotCollected(), canRebirth = rebirthsAvailableNow() > 0 && notCollected.length > 0;
  element("buddiesLevelAndXp").textContent = `LV ${currentLevel()} · ${xpToSpend()} XP`;
  element("buddiesLevelAndXp").setAttribute("aria-label", `${petName()} is level ${currentLevel()}. You have ${xpToSpend()} XP.`);
  element("buddiesHint").textContent = !notCollected.length
    ? "You've collected every pet! New ones are on the way."
    : canRebirth ? "Rebirth ready! Pick a new pet. It starts at level 1, and you keep everything you've unlocked."
    : `Collect them all! Get ${petName()} to level ${REBIRTH_EVERY_LEVELS} to rebirth as a new pet. Your old pet becomes an angel, and you can tap it to play as them again.`;
  const buddyCards = myBuddies.map(buddy => `<button type="button" class="buddy" data-buddy="${buddy.id}" aria-pressed="${buddy.isActive}">
      <canvas ${buddy.isActive ? 'width="112" height="112"' : 'class="angel" width="24" height="20"'}></canvas><strong>${escapeHtml(buddy.petName)}</strong>
      <span class="level-chip">LV ${buddyLevel(buddy.id)}</span>
      <span class="status">${buddy.isActive ? "Playing now" : "Angel · tap to play"}</span></button>`);
  // The pets still to collect: the rebirth button if one is ready, then up to MAX_MYSTERY_BUDDY_CARDS mystery padlocks
  // (one for every pet would make the page too long to scroll).
  const MAX_MYSTERY_BUDDY_CARDS = 3;
  const toCollectCards = notCollected.slice(0, MAX_MYSTERY_BUDDY_CARDS + (canRebirth ? 1 : 0)).map((petType, index) => index === 0 && canRebirth
    ? `<button type="button" class="buddy adopt" data-rebirth aria-pressed="${rebirthPanelOpen}"><span class="plus" aria-hidden="true">+</span><strong>Rebirth</strong><span class="status">Pick your next pet</span></button>`
    : `<div class="buddy locked" role="img" aria-label="A pet still to collect">${LOCK_ICON}<strong>?</strong><span class="status">Rebirth every ${REBIRTH_EVERY_LEVELS} levels</span></div>`);
  const grid = element("buddyGrid");
  grid.innerHTML = [...buddyCards, ...toCollectCards].join("");
  grid.querySelectorAll("[data-buddy]").forEach(card => {
    const buddy = myBuddies.find(candidate => candidate.id === card.dataset.buddy), canvas = card.querySelector("canvas");
    if (buddy.isActive) drawPet(canvas, buddy.petType, { fitTight: true, petLook: activeLook.petLook });
    else drawAngelThumbnail(canvas, buddy, theme);
    card.onclick = () => { if (!buddy.isActive) switchToBuddy(buddy.id); };
  });
  grid.querySelectorAll("[data-rebirth]").forEach(card => card.onclick = () => openRebirthPanel());
  element("rebirthPanel").hidden = !rebirthPanelOpen;
}
/* Switching back to a buddy carries on from that buddy's own level. */
let switchingBuddy = false;
async function switchToBuddy(buddyId) {
  if (switchingBuddy) return;   // ignore double taps
  switchingBuddy = true;
  try {
    currentProfile = await dataLayer.setActiveBuddy(buddyId);
    myBuddies = myBuddies.map(buddy => ({ ...buddy, isActive: buddy.id === buddyId }));
    // Each buddy has its own items, XP, place and unlock order: load this one's.
    await loadPlayingBuddyData();
    levelsSeen = {};
    applyThemeColour(currentProfile.theme_colour);   // each buddy has its own game colour
    hideSaveError();
    renderBuddies();
  } catch (error) {
    showSaveError("Couldn't swap buddies. Check your internet and try again.", () => switchToBuddy(buddyId));
  }
  switchingBuddy = false;
}
function openRebirthPanel() {
  rebirthPanelOpen = true;
  rebirthPetType = petTypesNotCollected()[0];
  element("rebirthPetNameInput").value = "";
  showFieldError("rebirthPetNameInput", "rebirthError", "");
  element("rebirthNote").textContent = `${petName()} will become an angel and keep all their things. Your new buddy starts from scratch, with its own XP, items, places and Shop, unlocked in a new order. You can switch back to ${petName()} any time and carry on from level ${currentLevel()}.`;
  renderRebirthPicker();
  renderBuddyList();
  element("rebirthPanel").scrollIntoView({ block: "nearest" });
}
/* Only pets you haven't collected yet can be picked. */
function renderRebirthPicker() {
  const options = petTypesNotCollected().map(petType => ({ id: petType, label: PET_TYPES[petType].label, unlockLevel: 1 }));
  renderOptionPicker("rebirthPetPicker", options, rebirthPetType, 1, petType => { rebirthPetType = petType; renderRebirthPicker(); },
    (canvas, optionId) => drawPet(canvas, optionId, { fitTight: true }));
  element("rebirthPetNameLabel").textContent = `Name your ${PET_TYPES[rebirthPetType].label.toLowerCase()}`;
}
element("rebirthCancel").onclick = () => { rebirthPanelOpen = false; renderBuddyList(); };
element("rebirthPanel").onsubmit = async event => {
  event.preventDefault();
  const { name, error } = validateName(element("rebirthPetNameInput").value);
  showFieldError("rebirthPetNameInput", "rebirthError", error);
  if (error) return;
  const button = element("rebirthConfirm");
  button.disabled = true;
  try {
    currentProfile = await dataLayer.rebirthAsNewPet(rebirthPetType, name);
  } catch (error) {
    const messages = { "no-rebirth": `A buddy needs to reach level ${REBIRTH_EVERY_LEVELS} first.`, "already-collected": "You've already got that pet." };
    if (messages[error.message]) showFieldError("rebirthPetNameInput", "rebirthError", messages[error.message]);
    else showSaveError("Couldn't do the rebirth. Check your internet and try again.", () => element("rebirthPanel").requestSubmit());
    button.disabled = false;
    return;
  }
  rebirthPanelOpen = false;
  button.disabled = false;
  // The rebirth worked. If refreshing fails, reload the whole game rather than say it failed.
  // The new buddy starts from scratch with its own unlock order and Shop.
  try { [myBuddies] = await Promise.all([dataLayer.loadMyBuddies(), loadPlayingBuddyData()]); levelsSeen = {}; }
  catch (error) { openGame(); return; }
  hideSaveError();
  renderBuddies();
  window.scrollTo(0, 0);
};
function renderCustomise() {
  const level = unlockedLevel(), look = lookFromProfile(currentProfile), petLook = look.petLook;
  const withPetLook = changes => ({ petLook: { ...petLook, ...changes } });
  const thumbnail = changes => (canvas, optionId) => drawPet(canvas, look.petType, { fitTight: true, petLook: { ...petLook, ...changes(optionId) } });
  renderStage(element("customiseStage"), gameLook());
  element("customisePetHeading").textContent = `${look.petName}'s look`;
  element("gameColourHeading").textContent = `${look.petName}'s game colour`;
  renderOptionPicker("customiseBodyColourPicker", BODY_COLOURS, petLook.bodyColour, level, id => saveLookChange(withPetLook({ bodyColour: id })), thumbnail(id => ({ bodyColour: id })));
  renderOptionPicker("customiseFacePicker", FACES, petLook.face, level, id => saveLookChange(withPetLook({ face: id })), thumbnail(id => ({ face: id })));
  renderOptionPicker("customiseArmsPicker", ARM_POSES, petLook.arms, level, id => saveLookChange(withPetLook({ arms: id })), thumbnail(id => ({ arms: id })));
  renderOptionPicker("customiseWidthPicker", BODY_WIDTHS, petLook.width, level, id => saveLookChange(withPetLook({ width: id })));
  renderOptionPicker("customiseHeightPicker", BODY_HEIGHTS, petLook.height, level, id => saveLookChange(withPetLook({ height: id })));
  renderColourPicker("customiseThemePicker", look.themeColour, id => saveLookChange({ themeColour: id }));
}
async function saveLookChange(changes) {
  const previousProfile = currentProfile;
  const nextLook = { ...lookFromProfile(currentProfile), ...changes };
  currentProfile = profileWithLook(currentProfile, nextLook);
  applyThemeColour(nextLook.themeColour);
  rerenderCurrentScreen();
  setCustomiseStatus("Saving…");
  try {
    currentProfile = await dataLayer.updateMyProfile(nextLook);
    hideSaveError();
    setCustomiseStatus("Saved");
  } catch (error) {
    currentProfile = previousProfile;
    applyThemeColour(currentProfile.theme_colour);
    rerenderCurrentScreen();
    setCustomiseStatus("Not saved");
    showSaveError("Couldn't save that change. Check your internet and try again.", () => saveLookChange(changes));
  }
}
function setCustomiseStatus(text) { element("customiseStatus").textContent = text; }

/* ---------- Shop: buy things with XP (no level needed). Bought things go to Inventory or House. ---------- */
document.querySelectorAll("[data-stuff]").forEach(button => button.onclick = () => {
  if (button.dataset.stuff === "screenShop") openShop(); else openInventory();
});
element("openShopButton").onclick = () => openShop();
function openShop() { showScreen("screenShop"); renderShop(); }
function renderShop() {
  const look = lookFromProfile(currentProfile), wallet = xpToSpend();
  element("shopXpNumber").textContent = wallet;
  // Each buddy's Shop sells its own selection (anything this buddy already bought stays on show).
  const shopItems = INVENTORY_ITEMS.filter(item => inBuddyShop(item) || (isShopItem(item) && myPurchases.includes(item.id)))
    .sort((first, second) => first.xpPrice - second.xpPrice);
  const grid = element("shopGrid");
  const boxPrizes = mysteryBoxChances(ownsItemNow, powerValue("lucky")), boxesLeft = MYSTERY_BOXES_PER_DAY - myChance.boxesOpenedToday;
  const boxCard = !chanceFeaturesOn() ? "" : `<button type="button" class="item mystery-box${wallet < MYSTERY_BOX_PRICE ? " too-dear" : ""}" id="mysteryBoxCard">
      <canvas width="16" height="16"></canvas><strong>Mystery box</strong>
      <span class="odds-line">${powerValue("lucky") ? "✨ Lucky: " : ""}${RARITIES.map(rarity => `${rarity.shortLabel} ${Math.round(mysteryBoxRarityOdds(powerValue("lucky"))[rarity.id] * 100)}%`).join(" · ")}</span>
      ${boxesLeft <= 0 ? `<span class="status">Back tomorrow</span>` : `<span class="price-tag">${MYSTERY_BOX_PRICE} XP</span>`}</button>`;
  grid.innerHTML = boxCard + (shopItems.length ? shopItems.map(item => {
    const owned = myPurchases.includes(item.id), price = shopPrice(item, powerValue("bargain")), tooDear = !owned && price > wallet;
    const thumbSize = item.category === "pets" ? 16 : item.category === "house" ? 28 : 112;
    return `<button type="button" class="item${tooDear ? " too-dear" : ""}" data-shop-item="${item.id}" aria-pressed="${owned}">
      <canvas width="${thumbSize}" height="${thumbSize}"></canvas><strong>${item.label}</strong>
      ${rarityBadgeHtml(item.rarity)}
      ${cardPowersHtml(item)}
      ${owned ? `<span class="status">Yours</span>` : `<span class="price-tag">${price < item.xpPrice ? `<s>${item.xpPrice}</s>` : ""}${price} XP</span>`}</button>`;
  }).join("") : `<div class="empty" style="grid-column:1/-1"><strong>Nothing in the Shop yet</strong><span class="hint">New things get added all the time.</span></div>`);
  if (element("mysteryBoxCard")) { drawMysteryBox(element("mysteryBoxCard").querySelector("canvas"), getThemeColour(look.themeColour)); element("mysteryBoxCard").onclick = openMysteryBoxSheet; }
  grid.querySelectorAll("[data-shop-item]").forEach(button => {
    drawItemThumbnail(button.querySelector("canvas"), getInventoryItem(button.dataset.shopItem), look);
    button.onclick = () => openBuySheet(button.dataset.shopItem);
  });
}
/* A small picture of any item: on the pet, or standing on the floor for pets and house things. */
function drawItemThumbnail(canvas, item, look) {
  const theme = getThemeColour(look.themeColour);
  if (item.category === "pets") drawCompanionThumbnail(canvas, item.id, theme);
  else if (item.category === "house") {
    if (item.structural) drawLocationScene(canvas, "home", theme, [item.id]); else drawDecorationThumbnail(canvas, item.id, theme);
  } else drawPet(canvas, look.petType, { equipped: [item.id], petLook: look.petLook, fitTight: true });
}
/* ---------- Chance: Mystery box and Take a chance ----------
   Step 1 shows the odds. Step 2 shakes the box while the server rolls, then reveals the result. */
function drawMysteryBox(canvas, themeColour) {
  const scene = createScenePainter(canvas, themeColour), { fill, themeShade } = scene;
  scene.context.clearRect(0, 0, canvas.width, canvas.height);
  fill(2, 6, 12, 9, themeShade(48, 10)); fill(1, 4, 14, 3, themeShade(58, 10)); fill(2, 7, 12, 1, themeShade(38, 10));
  fill(7, 4, 2, 11, "#F2C95C"); fill(1, 5, 14, 1, "#F2C95C");
  fill(4, 1, 3, 3, "#F2C95C"); fill(9, 1, 3, 3, "#F2C95C"); fill(5, 2, 1, 1, "#B88A1E"); fill(10, 2, 1, 1, "#B88A1E"); fill(7, 3, 2, 1, "#E9B92F");
  fill(7, 9, 2, 2, "#FFFFFF");
}
let chanceMode = null, chanceItemId = null, chanceRolling = false;
const chanceSheetIsOpen = () => !element("chanceSheet").hidden;
function showChanceSheet() { element("chanceSheet").hidden = false; element("chanceSheetClose").focus(); }
function closeChanceSheet() {
  if (chanceRolling) return;
  // Closing a New item pop-up without rolling = Keep it. The chance is gone after this.
  if (chanceMode === "new-item" && chanceItemId && !myChance.triedItemIds.includes(chanceItemId) && canTakeAChance(getInventoryItem(chanceItemId))) {
    myChance.triedItemIds = [...myChance.triedItemIds, chanceItemId];
    dataLayer.keepNewItem(chanceItemId).catch(() => {}); // if this save fails, the level-up rule still stops a later chance
  }
  if (newItemQueue.length) { showNextNewItem(); return; }   // more new items to show
  element("chanceSheet").hidden = true; chanceMode = null; rerenderCurrentScreen(); renderProgress();
}
element("chanceSheetClose").onclick = closeChanceSheet;
element("chanceSheet").addEventListener("click", event => { if (event.target === element("chanceSheet") && !mustChooseNow()) closeChanceSheet(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && chanceSheetIsOpen() && !mustChooseNow()) closeChanceSheet(); });
function setChancePreview(drawOnCanvas, state) {
  const box = element("chancePreviewBox"), canvas = element("chanceSheetPreview");
  box.classList.remove("shaking", "revealed"); box.style.borderColor = ""; box.style.background = "";
  drawOnCanvas(canvas);
  if (state) { void box.offsetWidth; box.classList.add(state); }
}
function hideChancePowers() { element("chanceSheetPowers").hidden = true; }
/* While Keep it / Take a chance is showing, there's no ✕ and tapping outside or Escape does nothing: they must choose. */
function showChoiceRow(show) { element("chanceChoiceRow").hidden = !show; element("chanceSheetGo").hidden = show; element("chanceSheetClose").hidden = show; }
const mustChooseNow = () => !element("chanceChoiceRow").hidden;
function oddsRowHtml(chance, labelHtml, gemColour) {
  return `<li><span class="odds-pct">${chanceText(chance)}</span>${gemColour ? `<span class="gem" style="background:${gemColour}"></span>` : ""}<span>${labelHtml}</span></li>`;
}

/* Treasure finder power: a free surprise item each week, revealed like a Mystery box. */
function openTreasureSheet() {
  chanceMode = "treasure"; chanceItemId = null;
  hideChancePowers();
  const theme = getThemeColour(currentProfile.theme_colour);
  setChancePreview(canvas => { canvas.width = canvas.height = 16; drawMysteryBox(canvas, theme); });
  element("chanceSheetTitle").textContent = "Treasure finder";
  element("chanceSheetBadge").innerHTML = `<span class="price-tag">FREE</span>`;
  element("chanceSheetSub").textContent = "Your surprise item this week";
  element("chanceOdds").hidden = true;
  element("chanceSheetNote").textContent = "✨ Your Treasure finder power found something. Open it!";
  showChoiceRow(false);
  const go = element("chanceSheetGo");
  go.disabled = false; go.textContent = "Open it";
  go.onclick = () => rollTheDice(() => dataLayer.claimWeeklyTreasure());
  showChanceSheet();
}

/* Milestone reward: a free box for reaching every 10th level with a buddy. */
let openMilestone = null;
function openMilestoneSheet(milestone) {
  chanceMode = "milestone"; chanceItemId = null; openMilestone = milestone;
  hideChancePowers();
  const theme = getThemeColour(currentProfile.theme_colour);
  setChancePreview(canvas => { canvas.width = canvas.height = 16; drawMysteryBox(canvas, theme); });
  element("chanceSheetTitle").textContent = `Level ${milestone.level}!`;
  element("chanceSheetBadge").innerHTML = `<span class="price-tag">FREE</span>`;
  element("chanceSheetSub").textContent = `A reward for getting ${milestone.buddyName} to level ${milestone.level}`;
  element("chanceOdds").hidden = true;
  element("chanceSheetNote").textContent = `Every ${MILESTONE_EVERY_LEVELS} levels earns a free Mystery box. Open it!`;
  showChoiceRow(false);
  const go = element("chanceSheetGo");
  go.disabled = false; go.textContent = "Open it";
  go.onclick = () => rollTheDice(() => dataLayer.claimMilestoneBox(milestone.buddyId, milestone.level));
  showChanceSheet();
}

/* Mystery box: step 1 */
function openMysteryBoxSheet() {
  chanceMode = "box"; chanceItemId = null;
  hideChancePowers();
  const theme = getThemeColour(currentProfile.theme_colour), prizes = mysteryBoxChances(ownsItemNow, powerValue("lucky")), wallet = xpToSpend();
  const boxesLeft = MYSTERY_BOXES_PER_DAY - myChance.boxesOpenedToday;
  setChancePreview(canvas => { canvas.width = canvas.height = 16; drawMysteryBox(canvas, theme); });
  element("chanceSheetTitle").textContent = "Mystery box";
  element("chanceSheetBadge").innerHTML = `<span class="price-tag">${MYSTERY_BOX_PRICE} XP</span>`;
  element("chanceSheetSub").textContent = `You have ${wallet} XP · ${Math.max(0, boxesLeft)} of ${MYSTERY_BOXES_PER_DAY} left today`;
  // Odds by rarity, worked out from what's actually left for this child (always adds up to 100%).
  const byRarity = RARITIES.map(rarity => ({ rarity, chance: prizes.filter(entry => entry.item.rarity === rarity.id).reduce((total, entry) => total + entry.chance, 0) }))
    .filter(entry => entry.chance > 0);
  element("chanceOdds").hidden = false;
  element("chanceOdds").innerHTML = byRarity.map(entry => oddsRowHtml(entry.chance, `<b>${entry.rarity.label}</b> item`, entry.rarity.colour)).join("");
  element("chanceSheetNote").textContent = (powerValue("lucky") ? "✨ Lucky is on: rarer things are more likely. " : "")
    + "Any rarity can come up, every time. Things you already have turn into XP back.";
  const go = element("chanceSheetGo");
  showChoiceRow(false);
  if (boxesLeft <= 0) { go.textContent = "That's all for today. Back tomorrow!"; go.disabled = true; }
  else if (wallet < MYSTERY_BOX_PRICE) { setButtonText(go, `You need ${MYSTERY_BOX_PRICE - wallet} more XP`); go.disabled = true; }
  else { setButtonText(go, `Open for ${MYSTERY_BOX_PRICE} XP`); go.disabled = false; }
  go.onclick = () => rollTheDice(() => dataLayer.openMysteryBox());
  showChanceSheet();
}

function takeAChanceOddsHtml(item) {
  const prizes = rarerPrizesFor(item, ownsItemNow), commons = commonSwapsFor(item, ownsItemNow);
  const prizeRarity = getRarity(prizes[0].rarity), thirds = takeAChanceOutcomes(powerValue("daring"));
  return oddsRowHtml(thirds[0].chance, `${powerValue("daring") ? "✨ " : ""}Win a random <b>${prizeRarity.label}</b> item`, prizeRarity.colour)
    + oddsRowHtml(thirds[1].chance, `Keep your ${escapeHtml(item.label)}`, null)
    + oddsRowHtml(thirds[2].chance, commons.length ? `Swap it for a random <b>Common</b> item` : `Keep your ${escapeHtml(item.label)} (no Commons left to swap)`, commons.length ? getRarity("common").colour : null);
}

/* ---------- New item pop-up (after levelling up) ----------
   Each new item is shown on its own, big and clear, with two choices: Keep it, or Take a chance.
   They have to pick one: there's no ✕ while the choice is showing. */
let newItemQueue = [], newItemTotal = 0;
function queueNewItemReveals(itemIds) {
  newItemQueue = [...newItemQueue, ...itemIds];
  newItemTotal = newItemQueue.length;
  if (!chanceSheetIsOpen()) showNextNewItem();
}
function showNextNewItem() {
  const itemId = newItemQueue.shift(), item = getInventoryItem(itemId);
  if (!item) { closeChanceSheet(); return; }
  chanceMode = "new-item"; chanceItemId = itemId;
  const look = lookFromProfile(currentProfile), rarity = getRarity(item.rarity), position = newItemTotal - newItemQueue.length;
  setChancePreview(canvas => { canvas.width = canvas.height = thumbnailSizeFor(item); drawItemThumbnail(canvas, item, look); }, "revealed");
  element("chancePreviewBox").style.borderColor = rarity.colour;
  element("chanceSheetTitle").innerHTML = `<span class="new-flag">NEW!</span><br>${escapeHtml(item.label)}`;
  element("chanceSheetBadge").innerHTML = rarityBadgeHtml(item.rarity);
  element("chanceSheetPowers").hidden = false;
  element("chanceSheetPowers").innerHTML = powersListHtml(item);
  element("chanceSheetSub").textContent = `Unlocked at level ${item.unlockLevel}` + (newItemTotal > 1 ? ` · ${position} of ${newItemTotal}` : "");
  const where = item.category === "house" ? "Places → House" : "your Inventory";
  if (canTakeAChance(item)) {
    element("chanceOdds").hidden = false;
    element("chanceOdds").innerHTML = takeAChanceOddsHtml(item);
    element("chanceSheetNote").textContent = `Keep it, or take a chance on something rarer? You can only take a chance now, while it's brand new.`;
    showChoiceRow(true);
    element("chanceKeepButton").textContent = "Keep it";
    element("chanceKeepButton").onclick = closeChanceSheet;
    element("chanceTakeButton").onclick = () => { showChoiceRow(false); chanceMode = "gamble"; rollTheDice(() => dataLayer.takeAChance(itemId)); };
  } else {
    element("chanceOdds").hidden = true;
    element("chanceSheetNote").textContent = `It's yours! Find it in ${where}.`;
    showChoiceRow(false);
    const go = element("chanceSheetGo");
    go.disabled = false; go.textContent = newItemQueue.length ? "Next" : "Nice!";
    go.onclick = closeChanceSheet;
  }
  showChanceSheet();
}
function thumbnailSizeFor(item) { return item.category === "pets" ? 16 : item.category === "house" ? 28 : 112; }

/* Step 2: shake while the server rolls (at least 0.9s so it feels like something happens), then reveal. */
const CHANCE_SHAKE_MS = 900, CHANCE_ROCK_MS = 1600;
async function rollTheDice(serverRoll) {
  if (chanceRolling) return;
  chanceRolling = true;
  const mode = chanceMode, riskedItem = chanceItemId ? getInventoryItem(chanceItemId) : null;
  const go = element("chanceSheetGo"), theme = getThemeColour(currentProfile.theme_colour);
  showChoiceRow(false);
  go.disabled = true; go.textContent = "…";
  element("chanceOdds").hidden = true; hideChancePowers();
  element("chanceSheetNote").textContent = mode === "box" ? "Opening…" : "Rolling…";
  // Mystery box: the box shakes. Take a chance: the item rocks, speeding up near the end.
  const previewBox = element("chancePreviewBox"), rocking = mode === "gamble";
  previewBox.classList.remove("revealed");
  previewBox.classList.add(rocking ? "rocking" : "shaking");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const waitMs = reduceMotion ? 0 : rocking ? CHANCE_ROCK_MS : CHANCE_SHAKE_MS;
  const speedUp = rocking && !reduceMotion ? setTimeout(() => previewBox.classList.add("faster"), waitMs * 0.6) : null;
  try {
    const [result] = await Promise.all([serverRoll(), new Promise(resolve => setTimeout(resolve, waitMs))]);
    clearTimeout(speedUp);
    previewBox.classList.remove("rocking", "faster");
    // Update what the app knows, from what the server decided.
    if (mode === "box") { myChance.boxesOpenedToday++; currentProgress.xpSpentInShop += MYSTERY_BOX_PRICE; }
    if (mode === "treasure") myChance.treasureClaimedThisWeek = true;
    if (mode === "milestone" && openMilestone) myChance.claimedMilestones = [...(myChance.claimedMilestones || []), `${openMilestone.buddyId}:${openMilestone.level}`];
    if (result.xpBack) currentProgress.xpSpentInShop -= result.xpBack;
    if (mode === "gamble") {
      myChance.triedItemIds = [...myChance.triedItemIds, riskedItem.id];
      if (result.outcome === "rarer" || result.outcome === "common") myChance.swappedAwayItemIds = [...myChance.swappedAwayItemIds, riskedItem.id];
      currentProfile = result.profile;
    }
    if (result.wonItemId) {
      myChance.wonItemIds = [...new Set([...myChance.wonItemIds, result.wonItemId])];
      if (!(result.wonItemId in myGotAtLevels)) myGotAtLevels[result.wonItemId] = unlockedLevel();
    }
    hideSaveError();
    chanceRolling = false;
    showChanceResult(mode, riskedItem, result);
  } catch (error) {
    chanceRolling = false;
    clearTimeout(speedUp);
    element("chancePreviewBox").classList.remove("shaking", "rocking", "faster");
    const messages = { "already-claimed": "You've had this week's free item.", "no-power": "That power isn't on.", "not-enough-xp": "You don't have enough XP.", "daily-limit": "That's all the boxes for today.", "sold-out": "There's nothing to win right now.", "already-tried": "You've already decided on this one.", "not-new": "You can only take a chance on something brand new.",
      "chance-off": `${myGrownUpsLabel().charAt(0).toUpperCase() + myGrownUpsLabel().slice(1)} has switched Mystery boxes and Take a chance off.` };
    if (error.message === "chance-off") currentProfile = { ...currentProfile, chance_features: false };
    element("chanceSheetNote").textContent = messages[error.message] || "Couldn't do that. Check your internet and try again.";
    go.disabled = !!messages[error.message]; go.textContent = "Try again";
  }
}
function showChanceResult(mode, riskedItem, result) {
  const look = lookFromProfile(currentProfile), go = element("chanceSheetGo");
  const shownItem = result.wonItemId ? getInventoryItem(result.wonItemId) : riskedItem, rarity = getRarity(shownItem.rarity);
  setChancePreview(canvas => { canvas.width = canvas.height = thumbnailSizeFor(shownItem); drawItemThumbnail(canvas, shownItem, look); }, "revealed");
  element("chancePreviewBox").style.borderColor = rarity.colour;
  // Show what the item you've ended up with can do.
  element("chanceSheetPowers").hidden = false;
  element("chanceSheetPowers").innerHTML = powersListHtml(shownItem);
  element("chanceSheetBadge").innerHTML = rarityBadgeHtml(shownItem.rarity);
  element("chanceSheetSub").textContent = shownItem.label;
  const where = shownItem.category === "house" ? "Places → House" : "your Inventory";
  if ((mode === "box" || mode === "treasure" || mode === "milestone") && result.duplicate) {
    element("chanceSheetTitle").textContent = `${rarity.label}!`;
    element("chanceSheetNote").textContent = `The ${shownItem.label}! You've already got it, so you get ${result.xpBack} XP back.`;
  } else if (mode === "milestone") {
    element("chanceSheetTitle").textContent = `${rarity.label}!`;
    element("chanceSheetNote").textContent = `Your level ${openMilestone.level} box had the ${shownItem.label} in it (${chanceText(result.chance)} chance). Find it in ${where}.`;
  } else if (mode === "treasure") {
    element("chanceSheetTitle").textContent = `${rarity.label}!`;
    element("chanceSheetNote").textContent = `Treasure finder found you the ${shownItem.label} (${chanceText(result.chance)} chance). Find it in ${where}.`;
  } else if (mode === "box") {
    element("chanceSheetTitle").textContent = `${rarity.label}!`;
    element("chanceSheetNote").textContent = `You got the ${shownItem.label}! The chance was ${chanceText(result.chance)}. Find it in ${where}.`;
  } else if (result.outcome === "rarer") {
    element("chanceSheetTitle").textContent = "You won!";
    element("chanceSheetNote").textContent = `Your ${riskedItem.label} became the ${shownItem.label} (${chanceText(result.chance)} chance). Find it in ${where}.`;
  } else if (result.outcome === "keep") {
    element("chanceSheetTitle").textContent = "Safe!";
    element("chanceSheetNote").textContent = `You kept your ${riskedItem.label}.`;
  } else {
    element("chanceSheetTitle").textContent = "Swapped";
    element("chanceSheetNote").textContent = `Your ${riskedItem.label} became the ${shownItem.label}. You could win your ${riskedItem.label} back from a Mystery box.`;
  }
  showChoiceRow(false);
  go.disabled = false; go.textContent = newItemQueue.length ? "Next" : "Nice!";
  go.onclick = closeChanceSheet;
  renderProgress();
}

let buyItemId = null, buySaving = false, justBoughtItemId = null;
function openBuySheet(itemId) {
  buyItemId = itemId; justBoughtItemId = null;
  renderBuySheet();
  element("buySheet").hidden = false;
  element("buySheetClose").focus();
}
function closeBuySheet() { element("buySheet").hidden = true; buyItemId = null; }
function renderBuySheet() {
  const item = getInventoryItem(buyItemId), look = lookFromProfile(currentProfile), wallet = xpToSpend(), owned = myPurchases.includes(item.id);
  const category = item.category === "house" ? { label: "House" } : INVENTORY_CATEGORIES.find(candidate => candidate.id === item.category);
  const preview = element("buySheetPreview");
  const size = item.category === "pets" ? 16 : item.category === "house" ? 28 : 112;
  preview.width = preview.height = size;
  drawItemThumbnail(preview, item, look);
  element("buySheetName").textContent = item.label;
  element("buySheetRarity").innerHTML = rarityBadgeHtml(item.rarity);
  element("buySheetType").textContent = category ? category.label : "";
  element("buySheetPowers").innerHTML = powersListHtml(item);
  const price = shopPrice(item, powerValue("bargain"));
  element("buySheetPrice").innerHTML = price < item.xpPrice ? `${price} XP <span class="power-note">✨ Bargain</span>` : `${price} XP`;
  element("buySheetWallet").textContent = wallet;
  const buyButton = element("buySheetBuy"), message = element("buySheetMessage");
  if (owned) {
    message.textContent = justBoughtItemId === item.id
      ? `It's yours! Find it in ${item.category === "house" ? "Places → House" : "your Inventory"}.`
      : "You already have this.";
    buyButton.textContent = item.category === "house" ? "Go to House" : "Go to Inventory";
    buyButton.disabled = false;
    buyButton.onclick = () => { closeBuySheet(); if (item.category === "house") openHouse(); else openInventory(item.category); };
    return;
  }
  const shortBy = price - wallet;
  message.textContent = shortBy > 0 ? `You need ${shortBy} more XP. Do missions on Home to earn some.` : `You'll have ${wallet - price} XP left.`;
  setButtonText(buyButton, buySaving ? "Buying…" : `Buy for ${price} XP`);
  buyButton.disabled = buySaving || shortBy > 0;
  buyButton.onclick = buyOpenItem;
}
async function buyOpenItem() {
  const itemId = buyItemId, item = getInventoryItem(itemId);
  buySaving = true; renderBuySheet();
  try {
    const { pricePaid } = await dataLayer.buyItem(itemId);
    myPurchases = [...myPurchases, itemId];
    if (!(itemId in myGotAtLevels)) myGotAtLevels[itemId] = unlockedLevel();
    currentProgress.xpSpentInShop += pricePaid;
    justBoughtItemId = itemId;
    hideSaveError();
  } catch (error) {
    const messages = { "not-enough-xp": "You don't have enough XP for that.", "already-owned": "You already have this." };
    showSaveError(messages[error.message] || "Couldn't buy that. Check your internet and try again.", messages[error.message] ? null : buyOpenItem);
  }
  buySaving = false;
  if (buyItemId === itemId) renderBuySheet();
  renderShop();
  renderProgress();
}
element("buySheetClose").onclick = closeBuySheet;
element("buySheet").addEventListener("click", event => { if (event.target === element("buySheet")) closeBuySheet(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !element("buySheet").hidden) closeBuySheet(); });

/* ---------- Friends: see how friends (added by a grown-up) are getting on ---------- */
/* Requests sent to you. The count shows on the Friends tab. */
let myFriendRequests = [];
/* The number shows on Friends and on More, which Friends is inside. */
function renderFriendsBadge() {
  [[document.querySelector('.tab[data-tab="friends"]'), "Friends"], [element("moreTab"), "More"]].forEach(([tab, label]) => {
    let badge = tab.querySelector(".tab-badge");
    if (!myFriendRequests.length) { if (badge) badge.remove(); tab.removeAttribute("aria-label"); return; }
    if (!badge) { badge = document.createElement("span"); badge.className = "tab-badge"; badge.setAttribute("aria-hidden", "true"); tab.append(badge); }
    badge.textContent = myFriendRequests.length > 9 ? "9+" : myFriendRequests.length;
    tab.setAttribute("aria-label", `${label}, ${myFriendRequests.length} new friend request${myFriendRequests.length === 1 ? "" : "s"}`);
  });
}
/* Checked when the game loads and on every tab change. (Supabase: a realtime subscription can push these instead.) */
async function refreshFriendRequests() {
  try { myFriendRequests = await dataLayer.loadMyFriendRequests(); } catch (error) { return; }
  renderFriendsBadge();
  if (!element("screenFriends").hidden) renderFriendRequests();
}
function personRowHtml(person, actionsHtml, extraClass = "") {
  return `<div class="request-row ${extraClass}" data-person="${person.id}"><canvas width="64" height="64"></canvas>
    <div class="who"><strong>${escapeHtml(person.displayName)}</strong><span>${escapeHtml(person.subtitle || "")}</span></div>
    <div class="actions">${actionsHtml}</div></div>`;
}
function drawPersonPets(container, people) {
  container.querySelectorAll("[data-person]").forEach(row => {
    const person = people.find(candidate => candidate.id === row.dataset.person || candidate.fromChildId === row.dataset.person);
    if (person) drawPet(row.querySelector("canvas"), person.petType, { fitTight: true, petLook: person.petLook });
  });
}
let mySentFriendRequests = [];
function renderSentFriendRequests() {
  element("sentRequestsBlock").hidden = !mySentFriendRequests.length;
  const list = element("sentRequestList");
  list.innerHTML = mySentFriendRequests.map(request => personRowHtml({ id: request.toChildId, displayName: request.displayName, subtitle: "Waiting for them to say yes" },
    `<button type="button" class="btn ghost" data-cancel-request="${request.id}">Cancel</button>`)).join("");
  drawPersonPets(list, mySentFriendRequests.map(request => ({ ...request, id: request.toChildId })));
  list.querySelectorAll("[data-cancel-request]").forEach(button => button.onclick = () => cancelSentRequest(button.dataset.cancelRequest, button));
}
async function cancelSentRequest(requestId, button) {
  button.disabled = true;
  try {
    await dataLayer.cancelFriendRequest(requestId);
    mySentFriendRequests = mySentFriendRequests.filter(request => request.id !== requestId);
    hideSaveError();
    renderSentFriendRequests();
    if (element("friendSearchInput").value.trim().length >= 2) runFriendSearch();
  } catch (error) {
    button.disabled = false;
    showSaveError("Couldn't cancel that. Check your internet and try again.", () => cancelSentRequest(requestId, button));
  }
}
async function refreshSentFriendRequests() {
  try { mySentFriendRequests = await dataLayer.loadMySentFriendRequests(); } catch (error) { return; }
  renderSentFriendRequests();
}
function renderFriendRequests() {
  element("friendRequestsBlock").hidden = !myFriendRequests.length;
  const list = element("friendRequestList");
  list.innerHTML = myFriendRequests.map(request => personRowHtml({ id: request.fromChildId, displayName: request.displayName, subtitle: "wants to be your friend" },
    `<button type="button" class="btn" data-accept="${request.id}">Accept</button><button type="button" class="btn ghost" data-decline="${request.id}">No thanks</button>`, "incoming")).join("");
  drawPersonPets(list, myFriendRequests);
  list.querySelectorAll("[data-accept]").forEach(button => button.onclick = () => answerRequest(button.dataset.accept, true));
  list.querySelectorAll("[data-decline]").forEach(button => button.onclick = () => answerRequest(button.dataset.decline, false));
}
const requestsBeingAnswered = new Set();
async function answerRequest(requestId, accept) {
  if (requestsBeingAnswered.has(requestId)) return;   // ignore double taps
  requestsBeingAnswered.add(requestId);
  document.querySelectorAll(`[data-accept="${requestId}"], [data-decline="${requestId}"]`).forEach(button => button.disabled = true);
  try {
    await dataLayer.answerFriendRequest(requestId, accept);
  } catch (error) {
    requestsBeingAnswered.delete(requestId);
    document.querySelectorAll(`[data-accept="${requestId}"], [data-decline="${requestId}"]`).forEach(button => button.disabled = false);
    if (error.message === "not-found") { refreshFriendRequests(); showSaveError("That request isn't there any more.", null); }
    else showSaveError("Couldn't answer that. Check your internet and try again.", () => answerRequest(requestId, accept));
    return;
  }
  requestsBeingAnswered.delete(requestId);
  myFriendRequests = myFriendRequests.filter(request => request.id !== requestId);
  hideSaveError();
  renderFriendsBadge();
  renderFriendRequests();
  // Refreshing the lists is separate: if it fails, the answer still went through.
  try { if (accept) renderFriends(await dataLayer.loadMyFriends()); } catch (error) { /* shows next time Friends opens */ }
  if (element("friendSearchInput").value.trim().length >= 2) runFriendSearch();
}
const SEARCH_ACTIONS = {
  "none": person => `<button type="button" class="btn" data-add="${person.id}">Add friend</button>`,
  "request-sent": () => `<span class="hint">Asked</span>`,
  "request-received": person => `<button type="button" class="btn" data-accept="${person.requestId}">Accept</button>`,
  "friend": () => `<span class="hint">Friends</span>`
};
async function runFriendSearch() {
  const searchText = element("friendSearchInput").value.trim(), hint = element("friendSearchHint"), results = element("friendSearchResults");
  if (searchText.length < 2) { hint.textContent = "Type at least 2 letters of their name."; results.innerHTML = ""; return; }
  hint.textContent = "Searching…";
  try {
    const people = await dataLayer.searchPlayers(searchText);
    hint.textContent = people.length ? "" : `No one called "${searchText}". Check the spelling?`;
    results.innerHTML = people.map(person => personRowHtml({ ...person, subtitle: person.relationship === "request-received" ? "wants to be your friend" : "" }, SEARCH_ACTIONS[person.relationship](person))).join("");
    drawPersonPets(results, people);
    results.querySelectorAll("[data-add]").forEach(button => button.onclick = () => addFriend(button.dataset.add, button));
    results.querySelectorAll("[data-accept]").forEach(button => button.onclick = () => answerRequest(button.dataset.accept, true));
  } catch (error) {
    hint.textContent = "Couldn't search. Check your internet and try again.";
  }
}
element("friendSearchForm").onsubmit = event => { event.preventDefault(); runFriendSearch(); };
async function addFriend(childId, button) {
  button.disabled = true;
  try {
    await dataLayer.sendFriendRequest(childId);
    button.outerHTML = `<span class="hint">Asked</span>`;
    refreshSentFriendRequests();
    hideSaveError();
  } catch (error) {
    if (error.message === "already-friends" || error.message === "already-asked") runFriendSearch();
    else { button.disabled = false; showSaveError("Couldn't send that. Check your internet and try again.", () => addFriend(childId, button)); }
  }
}
async function openFriends() {
  showScreen("screenFriends");
  element("friendList").innerHTML = loadingBuddyHtml("Loading your friends…");
  drawLoadingBuddies(element("friendList"));
  renderFriendRequests();
  element("sentRequestsBlock").hidden = true;
  try {
    const [friends, requests, sentRequests] = await Promise.all([dataLayer.loadMyFriends(), dataLayer.loadMyFriendRequests(), dataLayer.loadMySentFriendRequests()]);
    myFriendRequests = requests;
    mySentFriendRequests = sentRequests;
    renderSentFriendRequests();
    renderFriendsBadge();
    renderFriendRequests();
    renderFriends(friends);
    hideSaveError();
  } catch (error) {
    element("friendList").innerHTML = "";
    showSaveError("Couldn't load your friends. Check your internet and try again.", openFriends);
  }
}
function renderFriends(friends) {
  const list = element("friendList");
  if (!friends.length) {
    list.innerHTML = `<div class="empty"><strong>No friends yet</strong><span class="hint">Search for a friend's name above. When they say yes, you'll see their buddies and levels here.</span></div>`;
    return;
  }
  list.innerHTML = friends.map((friend, index) => {
    const name = escapeHtml(friend.displayName);
    return `<article class="friend-card">
      <h2>${name}</h2>
      <div class="stage" data-friend-stage="${index}"><canvas class="stage-bg"></canvas><span class="nameplate"></span><div class="stage-petbox"><canvas class="stage-pet" width="280" height="200" aria-label="${name}'s buddy"></canvas></div></div>
      <div class="friend-stats">
        <div><span class="label">Level</span><span class="big">${friend.level}</span></div>
        <div><span class="label">XP</span><span class="big">${friend.xpEarned}</span></div>
      </div>
      <div class="remove-friend" data-remove-area="${friend.id}">
        <button type="button" class="linkish" data-remove-friend="${friend.id}">Remove friend</button>
      </div>
    </article>`;
  }).join("");
  friends.forEach((friend, index) => {
    const stage = list.querySelector(`[data-friend-stage="${index}"]`);
    if (stage) renderStage(stage, friend.look);
  });
  // Removing asks once ("Are you sure?") right there on the card, so it can't happen by accident.
  list.querySelectorAll("[data-remove-friend]").forEach(button => button.onclick = () => {
    const friend = friends.find(candidate => candidate.id === button.dataset.removeFriend), area = button.parentElement;
    area.innerHTML = `<span>Stop being friends with ${escapeHtml(friend.displayName)}?</span>
      <div class="btnrow"><button type="button" class="btn ghost small" data-keep>Keep friend</button><button type="button" class="btn small danger" data-confirm-remove>Remove</button></div>`;
    area.querySelector("[data-keep]").onclick = () => renderFriends(friends);
    area.querySelector("[data-confirm-remove]").onclick = () => removeFriendNow(friend, friends);
  });
}
async function removeFriendNow(friend, friends) {
  try {
    await dataLayer.removeFriend(friend.id);
    hideSaveError();
    renderFriends(friends.filter(candidate => candidate.id !== friend.id));
  } catch (error) {
    showSaveError("Couldn't remove that friend. Check your internet and try again.", () => removeFriendNow(friend, friends));
  }
}

/* ---------- Locations ---------- */
function openLocations() { lastPlacesScreen = "screenLocations"; showScreen("screenLocations"); renderLocations(); }
let locationsSortMode = "all"; // "all" or "seasonPass"
element("locationsSortByAll").onclick = () => { locationsSortMode = "all"; renderLocations(); };
element("locationsSortBySeasonPass").onclick = () => { locationsSortMode = "seasonPass"; renderLocations(); };
function renderLocations() {
  const level = unlockedLevel(), look = lookFromProfile(currentProfile);
  renderStage(element("locationsStage"), gameLook());
  element("locationsSortByAll").setAttribute("aria-pressed", String(locationsSortMode === "all"));
  element("locationsSortBySeasonPass").setAttribute("aria-pressed", String(locationsSortMode === "seasonPass"));
  const grid = element("locationsGrid");
  if (locationsSortMode === "seasonPass") { element("locationsHint").textContent = ""; grid.innerHTML = seasonPassComingSoonHtml(); return; }
  element("locationsHint").textContent = `Pick where ${look.petName} hangs out. More places unlock as you level up.`;
  grid.innerHTML = [...LOCATIONS].sort((first, second) => first.unlockLevel - second.unlockLevel).map(location => {
    const unlocked = location.unlockLevel <= level, here = look.location === location.id;
    return unlocked
      ? `<button type="button" class="place" data-location="${location.id}" aria-pressed="${here}"><canvas width="48" height="36"></canvas><strong>${location.label}</strong><span class="status">${here ? "You're here" : "Tap to go"}</span></button>`
      : lockedCardHtml("place", location.unlockLevel);
  }).join("");
  grid.querySelectorAll("[data-location]").forEach(button => {
    drawLocationScene(button.querySelector("canvas"), button.dataset.location, getThemeColour(look.themeColour));
    button.onclick = () => saveLookChange({ location: button.dataset.location });
  });
}

/* ---------- House ---------- */
function openHouse() { lastPlacesScreen = "screenHouse"; showScreen("screenHouse"); renderHouse(); }
const houseBrowser = createCollectionBrowser({
  name: "house", types: HOUSE_TYPES, typeOf: item => item.houseType, includes: item => item.category === "house", render: () => renderHouse()
});
wireBrowser(houseBrowser, "houseGrid");
function renderHouse() {
  const level = unlockedLevel(), look = lookFromProfile(currentProfile), equipped = currentProfile.equipped_items;
  renderStage(element("houseStage"), { ...gameLook(), location: "home" });
  const group = renderBrowserControls(houseBrowser);
  if (!group) { element("houseHint").textContent = ""; element("houseGrid").innerHTML = seasonPassComingSoonHtml(); return; }
  const items = browserItems(houseBrowser);
  element("houseHint").textContent = group.hint + (look.location === "home" ? "" : ` You'll see them when ${look.petName} is at Home.`);
  const grid = element("houseGrid");
  grid.innerHTML = items.length ? items.map(item => {
    const unlocked = isItemUnlocked(item, level), out = equipped.includes(item.id);
    return unlocked
      ? `<button type="button" class="place" data-house-item="${item.id}" aria-pressed="${out}"><canvas class="${item.structural ? "" : "house-thumb"}" width="${item.structural ? 48 : 28}" height="${item.structural ? 36 : 28}"></canvas><strong>${item.label}</strong>${rarityBadgeHtml(item.rarity)}<span class="status">${item.structural ? (out ? "Added" : "Tap to add") : (out ? "In the house" : "Tap to put out")}</span></button>`
      : lockedCardHtml("place", item.unlockLevel);
  }).join("") : emptyCollectionHtml();
  grid.querySelectorAll("[data-house-item]").forEach(button => {
    const houseItem = getInventoryItem(button.dataset.houseItem);
    if (houseItem.structural) drawLocationScene(button.querySelector("canvas"), "home", getThemeColour(look.themeColour), [houseItem.id]);
    else drawDecorationThumbnail(button.querySelector("canvas"), houseItem.id, getThemeColour(look.themeColour));
    button.onclick = () => toggleInventoryItem(button.dataset.houseItem);
  });
}

/* ---------- Config ---------- */
let scheduleDraft = { daysOfWeek: [], timesPerDay: 1 };
function describeDays(daysOfWeek) {
  if (daysOfWeek.length === 7) return "Every day";
  if (daysOfWeek.length === 5 && SCHOOL_DAYS.every(day => daysOfWeek.includes(day))) return "School days";
  if (daysOfWeek.length === 2 && WEEKEND_DAYS.every(day => daysOfWeek.includes(day))) return "Weekends";
  return WEEK_DAYS.filter(day => daysOfWeek.includes(day.id)).map(day => day.label).join(", ");
}
function describeTimes(timesPerDay) { return timesPerDay === 1 ? "once a day" : timesPerDay === 2 ? "twice a day" : `${timesPerDay} times a day`; }
function renderScheduledTasks() {
  const list = element("scheduleList");
  list.innerHTML = myScheduledTasks.length
    ? myScheduledTasks.map(task => `<li><span class="what"><strong>${escapeHtml(task.title)}</strong><span class="hint">${describeDays(task.daysOfWeek)}, ${describeTimes(task.timesPerDay)}</span>`
      + (task.setBy === "parent" ? `<span class="set-by">Set by ${escapeHtml(myGrownUpsLabel())}</span></span>`
        : `</span><button type="button" class="remove" data-remove-schedule="${task.id}" aria-label="Remove ${escapeHtml(task.title)}">✕</button>`) + `</li>`).join("")
    : `<li class="empty" style="flex-direction:column;align-items:flex-start"><strong>None yet</strong><span class="hint">Add one below and it'll appear in Today's tasks on those days.</span></li>`;
  // Asks once before removing, right there in the list.
  list.querySelectorAll("[data-remove-schedule]").forEach(button => button.onclick = () => {
    const task = myScheduledTasks.find(candidate => candidate.id === button.dataset.removeSchedule), row = button.closest("li");
    row.innerHTML = `<span class="what"><strong>Remove ${escapeHtml(task.title)}?</strong></span>
      <span class="confirm-buttons"><button type="button" class="btn ghost small" data-keep-schedule>Keep</button><button type="button" class="btn small danger" data-confirm-remove-schedule>Remove</button></span>`;
    row.querySelector("[data-keep-schedule]").onclick = renderScheduledTasks;
    row.querySelector("[data-confirm-remove-schedule]").onclick = () => removeScheduledTask(task.id);
  });
  renderScheduleForm();
}
function renderScheduleForm() {
  element("scheduleDayPicker").innerHTML = WEEK_DAYS.map(day =>
    `<button type="button" data-day="${day.id}" aria-pressed="${scheduleDraft.daysOfWeek.includes(day.id)}" aria-label="${day.label}">${day.short}</button>`).join("");
  element("scheduleDayPicker").querySelectorAll("button").forEach(button => button.onclick = () => {
    const dayId = button.dataset.day;
    scheduleDraft.daysOfWeek = scheduleDraft.daysOfWeek.includes(dayId) ? scheduleDraft.daysOfWeek.filter(day => day !== dayId) : [...scheduleDraft.daysOfWeek, dayId];
    renderScheduleForm();
  });
  element("scheduleTimesValue").textContent = scheduleDraft.timesPerDay;
  element("scheduleTimesDown").disabled = scheduleDraft.timesPerDay <= 1;
  element("scheduleTimesUp").disabled = scheduleDraft.timesPerDay >= MAX_TIMES_PER_DAY;
  const full = myScheduledTasks.length >= MAX_SCHEDULED_TASKS;
  element("scheduleAddButton").disabled = full;
  if (full) element("scheduleError").textContent = `That's the most you can have (${MAX_SCHEDULED_TASKS}). Remove one to add another.`;
}
element("scheduleEveryDay").onclick = () => { scheduleDraft.daysOfWeek = WEEK_DAYS.map(day => day.id); renderScheduleForm(); };
element("scheduleSchoolDays").onclick = () => { scheduleDraft.daysOfWeek = [...SCHOOL_DAYS]; renderScheduleForm(); };
element("scheduleWeekends").onclick = () => { scheduleDraft.daysOfWeek = [...WEEKEND_DAYS]; renderScheduleForm(); };
element("scheduleTimesDown").onclick = () => { scheduleDraft.timesPerDay = Math.max(1, scheduleDraft.timesPerDay - 1); renderScheduleForm(); };
element("scheduleTimesUp").onclick = () => { scheduleDraft.timesPerDay = Math.min(MAX_TIMES_PER_DAY, scheduleDraft.timesPerDay + 1); renderScheduleForm(); };
element("scheduleForm").onsubmit = async event => {
  event.preventDefault();
  const title = element("scheduleTitleInput").value.trim();
  const tooFullDays = WEEK_DAYS.filter(day => scheduleDraft.daysOfWeek.includes(day.id)
    && myChores.length + myScheduledTasks.filter(task => task.daysOfWeek.includes(day.id)).reduce((total, task) => total + task.timesPerDay, 0) + scheduleDraft.timesPerDay > MAX_TASKS_PER_DAY);
  const error = !title ? "Type what the task is first." : !scheduleDraft.daysOfWeek.length ? "Pick at least one day."
    : tooFullDays.length ? `That would make more than ${MAX_TASKS_PER_DAY} tasks on ${tooFullDays.map(day => day.label).join(", ")}. Pick fewer days or fewer times.` : "";
  element("scheduleError").textContent = error;
  if (!title) element("scheduleTitleInput").setAttribute("aria-invalid", "true"); else element("scheduleTitleInput").removeAttribute("aria-invalid");
  if (error) return;
  element("scheduleAddButton").disabled = true;
  try {
    const task = await dataLayer.addMyScheduledTask({ title, daysOfWeek: WEEK_DAYS.map(day => day.id).filter(day => scheduleDraft.daysOfWeek.includes(day)), timesPerDay: scheduleDraft.timesPerDay });
    myScheduledTasks = [...myScheduledTasks, task];
    element("scheduleTitleInput").value = "";
    scheduleDraft = { daysOfWeek: [], timesPerDay: 1 };
    hideSaveError();
    renderScheduledTasks();
  } catch (saveError) {
    element("scheduleAddButton").disabled = false;
    if (saveError.message === "limit") { renderScheduleForm(); return; }
    if (saveError.message === "daily-limit") { element("scheduleError").textContent = `That would make more than ${MAX_TASKS_PER_DAY} tasks on some days. Pick fewer days or fewer times.`; return; }
    showSaveError("Couldn't add that scheduled task. Check your internet and try again.", () => element("scheduleForm").requestSubmit());
  }
};
async function removeScheduledTask(scheduledTaskId) {
  try {
    await dataLayer.removeMyScheduledTask(scheduledTaskId);
    myScheduledTasks = myScheduledTasks.filter(task => task.id !== scheduledTaskId);
    hideSaveError();
    element("scheduleError").textContent = "";
    renderScheduledTasks();
  } catch (error) {
    if (error.message === "set-by-grown-up") { element("scheduleError").textContent = `Only ${myGrownUpsLabel()} can remove that one.`; renderScheduledTasks(); return; }
    showSaveError("Couldn't remove that. Check your internet and try again.", () => removeScheduledTask(scheduledTaskId));
  }
}
function openConfigScreen() {
  showScreen("screenConfig");
  renderInstallSection();
  element("scheduleError").textContent = "";
  renderScheduledTasks();
  element("configSignedInAs").textContent = `Logged in as ${currentProfile.username || currentProfile.display_name}.`;
  renderChildSettings();
  renderGamesSetting();
  renderSchoolSettings();
  element("settingsError").textContent = "";
  // A grown-up may have changed these since the game loaded, so check again.
  dataLayer.getSignedInProfile().then(fresh => {
    if (!fresh || !currentProfile || fresh.id !== currentProfile.id || element("screenConfig").hidden) return;
    currentProfile = { ...currentProfile, timed_missions: fresh.timed_missions, reset_streak_on_miss: fresh.reset_streak_on_miss, chance_features: fresh.chance_features,
      child_can_change_settings: fresh.child_can_change_settings, grown_up_names: fresh.grown_up_names };
    renderChildSettings();
  }).catch(() => {});
}
/* "Alex", "Alex or Sam", or "your grown-up" if nobody's linked. */
function myGrownUpsLabel() {
  const names = (currentProfile && currentProfile.grown_up_names) || [];
  return names.length ? names.join(" or ") : "your grown-up";
}
function renderChildSettings() {
  element("settingTimedMissions").checked = !!currentProfile.timed_missions;
  element("settingResetStreak").checked = currentProfile.reset_streak_on_miss !== false;
  element("settingChanceFeatures").checked = chanceFeaturesOn();
  const locked = currentProfile.child_can_change_settings === false, grownUps = myGrownUpsLabel();
  ["settingTimedMissions", "settingResetStreak", "settingChanceFeatures"].forEach(id => element(id).disabled = locked);
  element("settingsLockedNote").hidden = !locked;
  element("settingsLockedNote").textContent = `🔒 ${grownUps.charAt(0).toUpperCase() + grownUps.slice(1)} looks after these settings. Ask them if you'd like one changed.`;
  // The grown-ups who look after this account.
  const names = currentProfile.grown_up_names || [];
  element("linkGrownUpHeading").textContent = names.length > 1 ? "Your grown-ups" : "Your grown-up";
  element("grownUpList").hidden = !names.length;
  element("grownUpList").innerHTML = names.map(name => `<li><span>${escapeHtml(name)}</span><span class="linked-tag">Linked</span></li>`).join("");
  element("linkGrownUpText").textContent = names.length
    ? `${names.join(" and ")} set up your account. They can set your tasks, ${locked ? "look after" : "see"} your settings, make you a new passcode and see how you're getting on.`
    : "Your grown-up looks after your account.";
}
async function saveSettings() {
  const previousProfile = currentProfile;
  const settings = { timedMissions: element("settingTimedMissions").checked, resetStreakOnMiss: element("settingResetStreak").checked, chanceFeatures: element("settingChanceFeatures").checked };
  currentProfile = { ...currentProfile, timed_missions: settings.timedMissions, reset_streak_on_miss: settings.resetStreakOnMiss, chance_features: settings.chanceFeatures };
  try {
    currentProfile = await dataLayer.updateMySettings(settings);
    element("settingsError").textContent = "";
  } catch (error) {
    currentProfile = previousProfile;
    renderChildSettings();
    element("settingsError").textContent = error.message === "set-by-grown-up"
      ? `${myGrownUpsLabel()} looks after these settings now.`.replace(/^./, letter => letter.toUpperCase())
      : "Couldn't save that setting. Check your internet and try again.";
  }
}
element("settingTimedMissions").onchange = saveSettings;
element("settingResetStreak").onchange = saveSettings;
element("settingChanceFeatures").onchange = saveSettings;
element("logOutButton").onclick = async () => {
  try { await turnOffRemindersHere(); } catch (error) {}   // while still signed in, so the server forgets this device
  try { await dataLayer.signOut(); } catch (error) {}
  resetSessionState();
  openLogin();
};

/* ---------- Parent and carer sign up ---------- */
function openParentSignUp() {
  closeLoginSheet();
  if (element("screenLogin").hidden) openLogin();
  element("parentSignUpForm").hidden = false;
  element("parentSignUpPasswordRule").textContent = `At least ${MIN_PASSCODE_LENGTH} characters.`;
  element("parentSignUpError").textContent = "";
  element("parentSignUpCheckEmail").hidden = true;
  setTimeout(() => {
    element("parentSignUpForm").scrollIntoView({ block: "start", behavior: "smooth" });
    element("parentSignUpName").focus({ preventScroll: true });
  }, 50);
}
element("openParentSignUpButton").onclick = openParentSignUp;
element("parentsPageSignUpButton").onclick = openParentSignUp;
/* SIGN_UP_OPEN: false = the sign-up buttons say "Coming soon" (everyone who already has an account can still log in).
   Only grown-ups sign up; children are added by their grown-up. */
const SIGN_UP_OPEN = true;
if (!SIGN_UP_OPEN) ["openParentSignUpButton", "parentsPageSignUpButton"].forEach(id => {
  const button = element(id); button.disabled = true; button.textContent = "Coming soon"; button.onclick = null;
});
element("parentSignUpCancel").onclick = () => { element("parentSignUpForm").hidden = true; };
element("parentSignUpForm").onsubmit = async event => {
  event.preventDefault();
  const displayName = element("parentSignUpName").value, email = element("parentSignUpEmail").value;
  const password = element("parentSignUpPassword").value, again = element("parentSignUpPasswordAgain").value;
  const say = message => { element("parentSignUpError").textContent = message; };
  if (!displayName.trim()) return say("Type your name first.");
  if (!email.trim()) return say("Type your email.");
  if (password.length < MIN_PASSCODE_LENGTH) return say(`Your password needs at least ${MIN_PASSCODE_LENGTH} characters.`);
  if (password !== again) return say("Those two passwords don't match.");
  element("parentSignUpButton").disabled = true;
  try {
    const profile = await dataLayer.signUpParent({ displayName, email, password });
    ["parentSignUpName", "parentSignUpEmail", "parentSignUpPassword", "parentSignUpPasswordAgain"].forEach(id => element(id).value = "");
    // Email confirmation is on: they finish signing up from the link we emailed, which brings them back here logged in.
    if (profile.needsEmailConfirmation) {
      say("");
      element("parentSignUpCheckEmail").textContent = `Nearly there! We've emailed a link to ${email.trim()}. Open it to finish making your account, then you can add your kids.`;
      element("parentSignUpCheckEmail").hidden = false;
      element("parentSignUpButton").disabled = false;
      return;
    }
    element("parentSignUpForm").hidden = true;
    await routeAfterSignIn(profile);
  } catch (error) {
    const messages = {
      "needs-name": "Type your name (up to 30 characters).",
      "bad-email": "That doesn't look like an email. Check it and try again.",
      "too-short": `Your password needs at least ${MIN_PASSCODE_LENGTH} characters.`,
      "email-taken": "That email already has an account. Try logging in instead."
    };
    say(messages[error.message] || "Couldn't make your account. Check your internet and try again.");
  }
  element("parentSignUpButton").disabled = false;
};

/* ---------- Parent account: a tab per linked child ----------
   Each tab: how they're getting on (stats), their tasks (scheduled tasks the parent sets), and their settings,
   including whether the child can change those settings themselves. "+ Link a child" links another with a code. */
let parentChildren = [];          // [{ id, displayName, setupComplete, level, petName, look }]
let parentOpenChildId = null;     // the open tab: a child's id, or "add"
let parentOverview = null;        // dataLayer.loadChildOverview() for the open child
let parentTaskDraft = { daysOfWeek: [], timesPerDay: 1 };

function showParentLoading(message) {
  element("parentLoading").innerHTML = loadingBuddyHtml(message);
  drawLoadingBuddies(element("parentLoading"));
}
function showParentLoadError(retry) {
  element("parentLoading").innerHTML = `<div class="block"><p>Couldn't load that. Check your internet and try again.</p><button type="button" class="btn" id="parentRetryButton">Try again</button></div>`;
  element("parentRetryButton").onclick = retry;
}
async function openParentHome(childIdToOpen = null) {
  showScreen("screenParentHome");
  applyThemeColour("green");
  element("parentGreeting").textContent = `Hi ${currentProfile.display_name}`;
  element("parentChildTabs").innerHTML = "";
  element("parentChildPanel").hidden = element("parentAddPanel").hidden = true;
  showParentLoading("Loading your kids…");
  try { parentChildren = await dataLayer.loadMyChildren(); }
  catch (error) { showParentLoadError(() => openParentHome(childIdToOpen)); return; }
  element("parentLoading").innerHTML = "";
  const stillLinked = id => parentChildren.some(child => child.id === id);
  const tabToOpen = [childIdToOpen, parentOpenChildId].find(stillLinked) || (parentChildren[0] ? parentChildren[0].id : "add");
  await openParentTab(tabToOpen);
  showParentNotifications();
}
/* Pop-up for news about their children, e.g. a child changed their game name. Shown once: closing marks them seen. */
let shownNotificationIds = [];
async function showParentNotifications() {
  let notifications;
  try { notifications = await dataLayer.loadMyNotifications(); } catch (error) { return; }
  if (!notifications.length || element("screenParentHome").hidden) return;
  shownNotificationIds = notifications.map(notice => notice.id);
  element("parentNoticeList").innerHTML = notifications.map(notice =>
    `<li><span class="power-text"><b>${escapeHtml(notice.oldName)} is now ${escapeHtml(notice.newName)}</b>`
    + `<span>Your child changed their game name, the name friends see. Their login username hasn't changed.</span></span></li>`).join("");
  element("parentNoticeSheet").hidden = false;
  element("parentNoticeOk").focus();
}
function closeParentNotifications() {
  if (element("parentNoticeSheet").hidden) return;
  element("parentNoticeSheet").hidden = true;
  dataLayer.markNotificationsSeen(shownNotificationIds).catch(() => {});   // if this fails, they'll see it again next time
  shownNotificationIds = [];
}
element("parentNoticeOk").onclick = closeParentNotifications;
element("parentNoticeSheet").addEventListener("click", event => { if (event.target === element("parentNoticeSheet")) closeParentNotifications(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeParentNotifications(); });
function drawChildBuddy(canvas, child) {
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  if (child.look) drawPet(canvas, child.look.petType, { fitTight: true, level: child.look.level, equipped: child.look.equipped, petLook: child.look.petLook, itemColours: child.look.itemColours || {} });
}
function renderParentTabs() {
  const tabs = element("parentChildTabs");
  tabs.innerHTML = parentChildren.map(child =>
    `<button type="button" class="child-tab" data-child-tab="${child.id}" aria-pressed="${child.id === parentOpenChildId}">${child.look ? `<canvas width="80" height="80" aria-hidden="true"></canvas>` : ""}${escapeHtml(child.displayName)}</button>`).join("")
    + `<button type="button" class="child-tab add" data-child-tab="add" aria-pressed="${parentOpenChildId === "add"}">+ Add a child</button>`;
  tabs.querySelectorAll("[data-child-tab]").forEach(button => {
    const child = parentChildren.find(candidate => candidate.id === button.dataset.childTab), canvas = button.querySelector("canvas");
    if (child && canvas) drawChildBuddy(canvas, child);
    button.onclick = () => openParentTab(button.dataset.childTab);
  });
}
async function openParentTab(tabId) {
  parentOpenChildId = tabId;
  renderParentTabs();
  hideSaveError();
  element("parentChildPanel").hidden = true;
  element("parentAddPanel").hidden = tabId !== "add";
  if (tabId === "add") {
    element("parentLoading").innerHTML = "";
    resetAddChildForm();
    return;
  }
  showParentLoading("Loading…");
  let overview;
  try { overview = await dataLayer.loadChildOverview(tabId); }
  catch (error) { if (handledNoLongerLinked(error, tabId)) return; if (parentOpenChildId === tabId) showParentLoadError(() => openParentTab(tabId)); return; }
  if (parentOpenChildId !== tabId) return; // they've already clicked another tab
  parentOverview = overview;
  parentSettingsSaved = { childId: tabId, settings: overview.settings };
  element("parentLoading").innerHTML = "";
  parentTaskDraft = { daysOfWeek: [], timesPerDay: 1 };
  element("parentTaskTitle").value = "";
  ["parentTaskError", "parentSettingsError", "parentUnlinkError", "parentPasscodeError", "parentPasscodeDone", "parentInviteError", "parentBirthError", "parentBirthDone"].forEach(id => element(id).textContent = "");
  element("parentNewPasscode").value = "";
  element("parentInviteCode").hidden = element("parentInviteHint").hidden = true;
  renderParentChild();
  element("parentChildPanel").hidden = false;
  loadParentLessonReminders(tabId);
}

/* ---------- Grown-ups: lesson reminders (feature "school") ----------
   On the child's tab: a notification the night before and/or the morning of a lesson (e.g. Core PE → "Get the PE kit
   and key ready"), to the grown-ups and/or the child. Lessons come from the child's MCAS timetable, so the subject is
   picked from it. send-reminders sends them at the two times set here; a day's lessons come in one notification. */
const LESSON_EVENING_HOURS = [15, 16, 17, 18, 19, 20, 21, 22], LESSON_MORNING_HOURS = [5, 6, 7, 8, 9, 10];   // the server's limits too
let parentLessons = null;   // { childId, reminders, subjects, eveningHour, morningHour }
async function loadParentLessonReminders(childId) {
  element("parentLessonSection").hidden = true;
  if (!featureOn("school")) return;
  let data;
  try { data = await dataLayer.loadChildLessonReminders(childId); } catch (error) { return; }
  if (parentOpenChildId !== childId) return;   // they've moved to another tab
  parentLessons = { childId, ...data };
  ["parentLessonError"].forEach(id => element(id).textContent = "");
  element("parentLessonNote").value = "";
  renderParentLessons();
  renderPushSwitch(GROWN_UP_REMINDER_SWITCH);
  element("parentLessonSection").hidden = false;
}
function renderParentLessons() {
  const { reminders, subjects, eveningHour, morningHour } = parentLessons, name = parentOverview.child.displayName;
  element("parentLessonIntro").textContent = `A notification before ${name}'s lessons, from their school timetable. You'll also get a copy of ${name}'s homework reminders.`;
  element("parentLessonChildName").textContent = name;
  element("parentLessonEvening").innerHTML = LESSON_EVENING_HOURS.map(hour => `<option value="${hour}"${hour === eveningHour ? " selected" : ""}>${hourText(hour)}</option>`).join("");
  element("parentLessonMorning").innerHTML = LESSON_MORNING_HOURS.map(hour => `<option value="${hour}"${hour === morningHour ? " selected" : ""}>${hourText(hour)}</option>`).join("");
  const subjectPicker = element("parentLessonSubject");
  subjectPicker.innerHTML = subjects.length ? subjects.map(subject => `<option>${escapeHtml(subject)}</option>`).join("") : `<option value="">No timetable yet</option>`;
  subjectPicker.disabled = element("parentLessonAddButton").disabled = !subjects.length;
  const list = element("parentLessonList");
  list.innerHTML = reminders.length ? reminders.map(reminder => {
    const when = [reminder.nightBefore && "night before", reminder.morningOf && "that morning"].filter(Boolean).join(" and ");
    const who = [reminder.toGrownUps && "grown-ups", reminder.toChild && name].filter(Boolean).join(" and ");
    return `<li><span class="what"><strong>${escapeHtml(reminder.subject)}</strong><span class="hint">${escapeHtml(reminder.note || "No note")}</span>`
      + `<span class="hint">${escapeHtml(`${when.charAt(0).toUpperCase()}${when.slice(1)}, to ${who}`)}</span></span>`
      + `<button type="button" class="remove" data-remove-lesson-reminder="${reminder.id}" aria-label="Remove the ${escapeHtml(reminder.subject)} reminder">✕</button></li>`;
  }).join("") : `<li class="empty" style="flex-direction:column;align-items:flex-start"><strong>None yet</strong><span class="hint">${subjects.length ? "Add one below." : `They show up once ${escapeHtml(name)}'s school timetable has synced.`}</span></li>`;
  list.querySelectorAll("[data-remove-lesson-reminder]").forEach(button => button.onclick = () => removeParentLessonReminder(button.dataset.removeLessonReminder));
}
element("parentLessonForm").onsubmit = async event => {
  event.preventDefault();
  const childId = parentLessons.childId;
  const reminder = { subject: element("parentLessonSubject").value, note: element("parentLessonNote").value.trim(),
    nightBefore: element("parentLessonNight").checked, morningOf: element("parentLessonMorningOf").checked,
    toChild: element("parentLessonToChild").checked, toGrownUps: element("parentLessonToMe").checked };
  const problem = !reminder.subject ? "Pick a lesson first." : !(reminder.nightBefore || reminder.morningOf) ? "Tick the night before, that morning, or both."
    : !(reminder.toChild || reminder.toGrownUps) ? "Tick who it goes to." : "";
  element("parentLessonError").textContent = problem;
  if (problem) return;
  element("parentLessonAddButton").disabled = true;
  try {
    const added = await dataLayer.addLessonReminder(childId, reminder);
    if (parentLessons.childId === childId) { parentLessons.reminders = [...parentLessons.reminders, added]; element("parentLessonNote").value = ""; renderParentLessons(); }
  } catch (error) {
    element("parentLessonError").textContent = error.message === "too-many" ? "That's 20 lesson reminders, the most for one child. Remove one first."
      : "Couldn't add that. Check your internet and try again.";
  }
  element("parentLessonAddButton").disabled = !parentLessons.subjects.length;
};
async function removeParentLessonReminder(reminderId) {
  const childId = parentLessons.childId;
  try {
    await dataLayer.removeLessonReminder(childId, reminderId);
    if (parentLessons.childId === childId) { parentLessons.reminders = parentLessons.reminders.filter(reminder => reminder.id !== reminderId); renderParentLessons(); }
  } catch (error) { element("parentLessonError").textContent = "Couldn't remove that. Check your internet and try again."; }
}
async function saveParentLessonTimes() {
  const childId = parentLessons.childId, before = { ...parentLessons };
  parentLessons.eveningHour = Number(element("parentLessonEvening").value);
  parentLessons.morningHour = Number(element("parentLessonMorning").value);
  element("parentLessonError").textContent = "";
  try { await dataLayer.setLessonReminderTimes(childId, parentLessons.eveningHour, parentLessons.morningHour); }
  catch (error) { parentLessons = before; renderParentLessons(); element("parentLessonError").textContent = "Couldn't save that. Check your internet and try again."; }
}
element("parentLessonEvening").onchange = saveParentLessonTimes;
element("parentLessonMorning").onchange = saveParentLessonTimes;
/* Rounds down, so 199 of 200 shows 99% (only all of them shows 100%). */
/* Another grown-up or device unlinked this child: reload the tabs instead of showing an internet error. */
function handledNoLongerLinked(error, childId) {
  if (error.message !== "not-your-child") return false;
  const child = parentChildren.find(candidate => candidate.id === childId);
  if (parentOpenChildId === childId) parentOpenChildId = null;
  openParentHome().then(() => showSaveError(`You're no longer linked to ${child ? child.displayName : "that account"}.`, null));
  return true;
}
const percentOf = (part, whole) => whole ? (part >= whole ? 100 : Math.floor(100 * part / whole)) : null;
function renderParentChild() {
  const { child, stats } = parentOverview, name = child.displayName;
  const buddyCanvas = element("parentChildBuddy");
  buddyCanvas.hidden = !child.look;
  drawChildBuddy(buddyCanvas, child);
  element("parentStatsHeading").textContent = `How ${name}'s getting on`;
  element("parentChildSummary").textContent = child.setupComplete
    ? `${child.petName} is level ${child.level}. Streak: ${stats.streak} ${stats.streak === 1 ? "day" : "days"}.`
    : `${name} hasn't finished setting up their buddy yet.`;

  element("parentStatToday").textContent = `${stats.tasksDoneToday}/${stats.tasksSetToday}`;
  element("parentStatTodayHint").textContent = `tasks done, and ${stats.missionsDoneToday} of ${MAX_MISSIONS_PER_DAY} missions`;
  const taskPercent = percentOf(stats.tasksDoneThisWeek, stats.tasksSetThisWeek);
  element("parentStatTasks").textContent = taskPercent === null ? "–" : `${taskPercent}%`;
  element("parentStatTasksHint").textContent = stats.tasksSetThisWeek ? `${stats.tasksDoneThisWeek} of ${stats.tasksSetThisWeek} done` : "No tasks set";
  element("parentStatMissions").textContent = stats.missionsDoneThisWeek;
  element("parentStatMissionsHint").textContent = stats.missionsDoneThisWeek > stats.missionsPossibleThisWeek
    ? `${MAX_MISSIONS_PER_DAY} a day, plus bonus missions` : `of ${stats.missionsPossibleThisWeek} (${MAX_MISSIONS_PER_DAY} a day)`;
  element("parentStatMissionsHint").textContent += `, including ${stats.feelGoodDoneThisWeek} Feel good`;
  const rightPercent = percentOf(stats.questionsRight, stats.questionsAnswered);
  element("parentStatRight").textContent = rightPercent === null ? "–" : `${rightPercent}%`;
  element("parentStatRightHint").textContent = stats.questionsAnswered ? `${stats.questionsRight} of ${stats.questionsAnswered} quiz and "What would you do?" answers, all time` : "No questions answered yet";

  const dayLabel = weekDay => WEEK_DAYS.find(day => day.id === weekDay).label;
  element("parentWeekStrip").innerHTML = stats.lastSevenDays.map((day, index) => {
    const isToday = index === stats.lastSevenDays.length - 1;
    return `<div class="week-day${isToday ? " today" : ""}"><div class="week-bar"><span style="height:${percentOf(day.done, day.set) || 0}%"></span></div><span>${isToday ? "Today" : dayLabel(day.weekDay)}</span><span>${day.done}/${day.set}</span></div>`;
  }).join("");
  element("parentWeekStrip").setAttribute("aria-label", "Tasks done each day: " + stats.lastSevenDays.map(day => `${dayLabel(day.weekDay)} ${day.done} of ${day.set}`).join(", "));

  element("parentTasksIntro").textContent = `Tasks show up in ${name}'s list on the days you pick. Up to ${MAX_TASKS_PER_DAY} a day in total, including any they add themselves.`;
  renderParentTasks();
  renderParentSettings();
  renderParentLogin();
  renderParentBirth();
  renderParentGrownUps();
}
function renderParentTasks() {
  const { child, tasks } = parentOverview, list = element("parentTaskList");
  list.innerHTML = tasks.length
    ? tasks.map(task => `<li><span class="what"><strong>${escapeHtml(task.title)}</strong><span class="hint">${describeDays(task.daysOfWeek)}, ${describeTimes(task.timesPerDay)}</span>`
        + (task.setBy === "child" ? `<span class="set-by">Added by ${escapeHtml(child.displayName)}</span>` : "")
        + `</span><button type="button" class="remove" data-remove-parent-task="${task.id}" aria-label="Remove ${escapeHtml(task.title)}">✕</button></li>`).join("")
    : `<li class="empty" style="flex-direction:column;align-items:flex-start"><strong>No tasks yet</strong><span class="hint">Add one below.</span></li>`;
  list.querySelectorAll("[data-remove-parent-task]").forEach(button => button.onclick = () => {
    const task = tasks.find(candidate => candidate.id === button.dataset.removeParentTask), row = button.closest("li");
    row.innerHTML = `<span class="what"><strong>Remove ${escapeHtml(task.title)}?</strong></span>
      <span class="confirm-buttons"><button type="button" class="btn ghost small" data-keep>Keep</button><button type="button" class="btn small danger" data-confirm-remove>Remove</button></span>`;
    row.querySelector("[data-keep]").onclick = renderParentTasks;
    row.querySelector("[data-confirm-remove]").onclick = () => removeParentTask(task.id);
  });
  renderParentTaskForm();
}
function renderParentTaskForm() {
  element("parentTaskDayPicker").innerHTML = WEEK_DAYS.map(day =>
    `<button type="button" data-day="${day.id}" aria-pressed="${parentTaskDraft.daysOfWeek.includes(day.id)}" aria-label="${day.label}">${day.short}</button>`).join("");
  element("parentTaskDayPicker").querySelectorAll("button").forEach(button => button.onclick = () => {
    const dayId = button.dataset.day;
    parentTaskDraft.daysOfWeek = parentTaskDraft.daysOfWeek.includes(dayId) ? parentTaskDraft.daysOfWeek.filter(day => day !== dayId) : [...parentTaskDraft.daysOfWeek, dayId];
    renderParentTaskForm();
  });
  element("parentTaskTimesValue").textContent = parentTaskDraft.timesPerDay;
  element("parentTaskTimesDown").disabled = parentTaskDraft.timesPerDay <= 1;
  element("parentTaskTimesUp").disabled = parentTaskDraft.timesPerDay >= MAX_TIMES_PER_DAY;
}
element("parentTaskEveryDay").onclick = () => { parentTaskDraft.daysOfWeek = WEEK_DAYS.map(day => day.id); renderParentTaskForm(); };
element("parentTaskSchoolDays").onclick = () => { parentTaskDraft.daysOfWeek = [...SCHOOL_DAYS]; renderParentTaskForm(); };
element("parentTaskWeekends").onclick = () => { parentTaskDraft.daysOfWeek = [...WEEKEND_DAYS]; renderParentTaskForm(); };
element("parentTaskTimesDown").onclick = () => { parentTaskDraft.timesPerDay = Math.max(1, parentTaskDraft.timesPerDay - 1); renderParentTaskForm(); };
element("parentTaskTimesUp").onclick = () => { parentTaskDraft.timesPerDay = Math.min(MAX_TIMES_PER_DAY, parentTaskDraft.timesPerDay + 1); renderParentTaskForm(); };
element("parentTaskForm").onsubmit = async event => {
  event.preventDefault();
  const childId = parentOpenChildId, title = element("parentTaskTitle").value.trim();
  const tooFullDays = WEEK_DAYS.filter(day => parentTaskDraft.daysOfWeek.includes(day.id)
    && parentOverview.tasks.filter(task => task.daysOfWeek.includes(day.id)).reduce((total, task) => total + task.timesPerDay, 0) + parentTaskDraft.timesPerDay > MAX_TASKS_PER_DAY);
  const error = !title ? "Type what the task is first." : !parentTaskDraft.daysOfWeek.length ? "Pick at least one day."
    : tooFullDays.length ? `That would make more than ${MAX_TASKS_PER_DAY} tasks on ${tooFullDays.map(day => day.label).join(", ")}. Pick fewer days or fewer times.` : "";
  element("parentTaskError").textContent = error;
  if (!title) element("parentTaskTitle").setAttribute("aria-invalid", "true"); else element("parentTaskTitle").removeAttribute("aria-invalid");
  if (error) return;
  element("parentTaskAddButton").disabled = true;
  try {
    const task = await dataLayer.addChildTask(childId, { title, daysOfWeek: WEEK_DAYS.map(day => day.id).filter(day => parentTaskDraft.daysOfWeek.includes(day)), timesPerDay: parentTaskDraft.timesPerDay });
    if (parentOpenChildId === childId) {
      parentOverview.tasks = [...parentOverview.tasks, task];
      element("parentTaskTitle").value = "";
      parentTaskDraft = { daysOfWeek: [], timesPerDay: 1 };
      hideSaveError();
      renderParentTasks();
    }
  } catch (saveError) {
    if (handledNoLongerLinked(saveError, childId)) { element("parentTaskAddButton").disabled = false; return; }
    if (parentOpenChildId !== childId) { element("parentTaskAddButton").disabled = false; return; } // they've moved to another tab
    const messages = { "limit": `That's the most scheduled tasks one child can have (${MAX_SCHEDULED_TASKS}). Remove one to add another.`,
      "daily-limit": `That would make more than ${MAX_TASKS_PER_DAY} tasks on some days. Pick fewer days or fewer times.` };
    if (messages[saveError.message]) element("parentTaskError").textContent = messages[saveError.message];
    else showSaveError("Couldn't add that task. Check your internet and try again.", () => element("parentTaskForm").requestSubmit());
  }
  element("parentTaskAddButton").disabled = false;
};
async function removeParentTask(taskId) {
  const childId = parentOpenChildId;
  try {
    await dataLayer.removeChildTask(childId, taskId);
    if (parentOpenChildId !== childId) return;
    parentOverview.tasks = parentOverview.tasks.filter(task => task.id !== taskId);
    hideSaveError();
    element("parentTaskError").textContent = "";
    renderParentTasks();
  } catch (error) {
    if (handledNoLongerLinked(error, childId)) return;
    showSaveError("Couldn't remove that. Check your internet and try again.", () => removeParentTask(taskId));
  }
}
function renderParentSettings() {
  const settings = parentOverview.settings;
  element("parentSettingTimed").checked = settings.timedMissions;
  element("parentSettingChance").checked = settings.chanceFeatures;
  element("parentSettingStreak").checked = settings.resetStreakOnMiss;
  element("parentSettingChildCanChange").checked = settings.childCanChangeSettings;
  element("parentSettingChildCanChangeLabel").textContent = `Let ${parentOverview.child.displayName} change these`;
}
let parentSettingsSaveNumber = 0; // only the latest save decides what's shown if one fails
let parentSettingsSaved = null;   // the settings the server last confirmed, for the open child
async function saveParentSettings() {
  const childId = parentOpenChildId, saveNumber = ++parentSettingsSaveNumber;
  if (!parentSettingsSaved || parentSettingsSaved.childId !== childId) parentSettingsSaved = { childId, settings: parentOverview.settings };
  const settings = { timedMissions: element("parentSettingTimed").checked, chanceFeatures: element("parentSettingChance").checked,
    resetStreakOnMiss: element("parentSettingStreak").checked, childCanChangeSettings: element("parentSettingChildCanChange").checked };
  parentOverview.settings = settings;
  try {
    await dataLayer.updateChildSettings(childId, settings);
    parentSettingsSaved = { childId, settings };
    if (saveNumber === parentSettingsSaveNumber) element("parentSettingsError").textContent = "";
  } catch (error) {
    if (handledNoLongerLinked(error, childId)) return;
    if (parentOpenChildId !== childId || saveNumber !== parentSettingsSaveNumber) return;
    parentOverview.settings = parentSettingsSaved.settings;
    renderParentSettings();
    element("parentSettingsError").textContent = "Couldn't save that setting. Check your internet and try again.";
  }
}
["parentSettingTimed", "parentSettingChance", "parentSettingStreak", "parentSettingChildCanChange"].forEach(id => element(id).onchange = saveParentSettings);
/* Login: the child's username, and a new passcode if they've forgotten theirs (children have no email). */
function renderParentLogin() {
  const { child, login } = parentOverview;
  element("parentChildUsername").textContent = login.username;
  element("parentNewPasscodeLabel").textContent = `New passcode for ${child.displayName}`;
  element("parentNewPasscodeHint").textContent = `Forgotten it? Make a new one here (at least ${MIN_PASSCODE_LENGTH} characters). Their old one stops working straight away.`;
}
element("parentPasscodeForm").onsubmit = async event => {
  event.preventDefault();
  const childId = parentOpenChildId, passcode = element("parentNewPasscode").value;
  element("parentPasscodeError").textContent = ""; element("parentPasscodeDone").textContent = "";
  if (passcode.length < MIN_PASSCODE_LENGTH) { element("parentPasscodeError").textContent = `Make it at least ${MIN_PASSCODE_LENGTH} characters.`; return; }
  element("parentPasscodeButton").disabled = true;
  try {
    await dataLayer.setChildPasscode(childId, passcode);
    if (parentOpenChildId === childId) {
      element("parentNewPasscode").value = "";
      element("parentPasscodeDone").textContent = `Done. ${parentOverview.child.displayName}'s new passcode is ${passcode}. Write it down for them.`;
    }
  } catch (error) {
    if (!handledNoLongerLinked(error, childId) && parentOpenChildId === childId)
      element("parentPasscodeError").textContent = "Couldn't change it. Check your internet and try again.";
  }
  element("parentPasscodeButton").disabled = false;
};
/* Age: the birth month and year missions are picked by. Only a grown-up can change it. */
function renderParentBirth() {
  const { child, birth } = parentOverview, age = ageFromBirthMonth(birth.month, birth.year);
  fillBirthSelects("parentBirthMonth", "parentBirthYear", birth.month, birth.year);
  element("parentBirthHint").textContent = age === null
    ? `Not given yet, so ${child.displayName} gets missions for ages ${DEFAULT_MISSION_AGES[0]} to ${DEFAULT_MISSION_AGES[1]}. Only you can change this.`
    : `${child.displayName} is ${age}, so gets missions for ${age} year olds. Only you can change this.`;
}
element("parentBirthForm").onsubmit = async event => {
  event.preventDefault();
  const childId = parentOpenChildId, birth = readBirthSelects("parentBirthMonth", "parentBirthYear");
  element("parentBirthError").textContent = birth.error; element("parentBirthDone").textContent = "";
  if (birth.error) return;
  element("parentBirthButton").disabled = true;
  try {
    await dataLayer.setChildBirthMonth(childId, { birthMonth: birth.birthMonth, birthYear: birth.birthYear });
    if (parentOpenChildId === childId) {
      parentOverview.birth = { month: birth.birthMonth, year: birth.birthYear };
      renderParentBirth();
      element("parentBirthDone").textContent = "Saved.";
    }
  } catch (error) {
    if (!handledNoLongerLinked(error, childId) && parentOpenChildId === childId)
      element("parentBirthError").textContent = error.message === "bad-birth-month"
        ? `Voxie is for children aged ${MIN_CHILD_AGE} to ${MAX_CHILD_AGE}. Check the month and year.` : "Couldn't save it. Check your internet and try again.";
  }
  element("parentBirthButton").disabled = false;
};
/* Grown-ups: who looks after this child, inviting another one, and removing yourself or deleting the account. */
function renderParentGrownUps() {
  const { child, grownUps } = parentOverview, name = escapeHtml(child.displayName), soleGrownUp = grownUps.length < 2;
  element("parentGrownUpList").innerHTML = grownUps.map(grownUp => `<li><span>${escapeHtml(grownUp)}${grownUp === currentProfile.display_name ? " (you)" : ""}</span><span class="linked-tag">Linked</span></li>`).join("");
  element("parentInviteText").textContent = `Want another grown-up to help look after ${child.displayName}? Make a code and give it to them. They type it into "+ Add a child" in their own Voxie account.`;
  element("parentUnlinkText").textContent = soleGrownUp
    ? `Deleting ${child.displayName}'s account removes their buddies, items and progress for good.`
    : `Removing ${child.displayName} from your account stops you seeing or changing it. Their account stays with the other grown-up.`;
  const row = element("parentUnlinkRow");
  row.innerHTML = soleGrownUp
    ? `<button type="button" class="btn small ghost" id="parentUnlinkButton">Delete ${name}'s account</button>`
    : `<button type="button" class="btn small ghost" id="parentUnlinkButton">Remove ${name} from my account</button>`;
  element("parentUnlinkButton").onclick = () => {
    row.innerHTML = soleGrownUp
      ? `<span class="what"><strong>Delete ${name}'s account and everything in it? This can't be undone.</strong></span>
         <button type="button" class="btn ghost small" data-keep>Keep it</button><button type="button" class="btn small danger" data-confirm-remove>Delete for good</button>`
      : `<span class="what"><strong>Remove ${name} from your account?</strong></span>
         <button type="button" class="btn ghost small" data-keep>Keep</button><button type="button" class="btn small danger" data-confirm-remove>Remove</button>`;
    row.querySelector("[data-keep]").onclick = renderParentGrownUps;
    row.querySelector("[data-confirm-remove]").onclick = () => removeOpenChild(soleGrownUp);
  };
}
element("parentInviteButton").onclick = async () => {
  const childId = parentOpenChildId;
  element("parentInviteButton").disabled = true; element("parentInviteError").textContent = "";
  try {
    const { code } = await dataLayer.createGrownUpInvite(childId);
    if (parentOpenChildId === childId) {
      element("parentInviteCode").textContent = code;
      element("parentInviteHint").textContent = `It works once, for ${LINK_CODE_HOURS} hours.`;
      element("parentInviteCode").hidden = element("parentInviteHint").hidden = false;
    }
  } catch (error) {
    if (!handledNoLongerLinked(error, childId) && parentOpenChildId === childId)
      element("parentInviteError").textContent = "Couldn't make a code. Check your internet and try again.";
  }
  element("parentInviteButton").disabled = false;
};
async function removeOpenChild(deleteAccount) {
  const childId = parentOpenChildId;
  try {
    if (deleteAccount) await dataLayer.deleteChildAccount(childId); else await dataLayer.unlinkChild(childId);
    parentOpenChildId = null;
    await openParentHome();
  } catch (error) {
    if (handledNoLongerLinked(error, childId)) return;
    if (error.message === "last-grown-up") { element("parentUnlinkError").textContent = "The other grown-up has gone, so you're the only one now."; await openParentTab(childId); return; }
    if (error.message === "not-only-grown-up") { element("parentUnlinkError").textContent = "Another grown-up has joined, so you can remove them from your account instead."; await openParentTab(childId); return; }
    element("parentUnlinkError").textContent = deleteAccount ? "Couldn't delete it. Check your internet and try again." : "Couldn't remove it. Check your internet and try again.";
    renderParentGrownUps();
  }
}
/* "+ Add a child": make the child's login, then show it so the grown-up can write it down. */
/* Birth month and year dropdowns ("+ Add a child" and the child's tab). Years run from MIN_CHILD_AGE to MAX_CHILD_AGE years ago. */
function fillBirthSelects(monthId, yearId, month = null, year = null) {
  const thisYear = Number(getTodayInUk().slice(0, 4));
  const years = Array.from({ length: MAX_CHILD_AGE - MIN_CHILD_AGE + 2 }, (_, index) => thisYear - MIN_CHILD_AGE - index);
  if (year && !years.includes(year)) years.push(year);   // a saved year that's now out of range still shows
  element(monthId).innerHTML = `<option value="">Month</option>` + MONTH_NAMES.map((name, index) => `<option value="${index + 1}"${month === index + 1 ? " selected" : ""}>${name}</option>`).join("");
  element(yearId).innerHTML = `<option value="">Year</option>` + years.map(option => `<option value="${option}"${year === option ? " selected" : ""}>${option}</option>`).join("");
}
/* { birthMonth, birthYear, error } from a pair of dropdowns, checking the child is MIN_CHILD_AGE to MAX_CHILD_AGE. */
function readBirthSelects(monthId, yearId) {
  const birthMonth = Number(element(monthId).value), birthYear = Number(element(yearId).value);
  if (!birthMonth || !birthYear) return { error: "Pick the month and year they were born." };
  const age = ageFromBirthMonth(birthMonth, birthYear);
  if (age < MIN_CHILD_AGE || age > MAX_CHILD_AGE) return { error: `Voxie is for children aged ${MIN_CHILD_AGE} to ${MAX_CHILD_AGE}. Check the month and year.` };
  return { birthMonth, birthYear, error: "" };
}
function resetAddChildForm() {
  ["parentAddUsername", "parentAddPasscode", "parentLinkCode"].forEach(id => element(id).value = "");
  ["parentAddError", "parentLinkError"].forEach(id => element(id).textContent = "");
  fillBirthSelects("parentAddBirthMonth", "parentAddBirthYear");
  element("parentAddPasscodeHint").textContent = `At least ${MIN_PASSCODE_LENGTH} characters. Pick something they'll remember but others won't guess.`;
  element("parentAddForm").hidden = false; element("parentAddDone").hidden = true;
}
/* No real name is asked for: the child is shown by their username until they make up a game name at setup. */
element("parentAddForm").onsubmit = async event => {
  event.preventDefault();
  const username = element("parentAddUsername").value, passcode = element("parentAddPasscode").value;
  const say = message => { element("parentAddError").textContent = message; };
  if (!/^[a-z0-9_-]{3,20}$/.test(username.trim().toLowerCase())) return say("Usernames are 3 to 20 letters or numbers, with no spaces (a dash is fine).");
  const birth = readBirthSelects("parentAddBirthMonth", "parentAddBirthYear");
  if (birth.error) return say(birth.error);
  if (passcode.length < MIN_PASSCODE_LENGTH) return say(`Make the passcode at least ${MIN_PASSCODE_LENGTH} characters.`);
  element("parentAddButton").disabled = true; say("");
  try {
    const child = await dataLayer.addChild({ birthMonth: birth.birthMonth, birthYear: birth.birthYear, username, passcode });
    parentChildren = [...parentChildren, child];
    renderParentTabs();
    element("parentAddForm").hidden = true; element("parentAddDone").hidden = false;
    element("parentAddDoneTitle").textContent = `${child.displayName} is ready to play! Here's their login:`;
    element("parentAddDoneUsername").textContent = username.trim().toLowerCase();
    element("parentAddDonePasscode").textContent = passcode;
    element("parentAddDoneOpen").textContent = `Go to ${child.displayName}'s tab`;
    element("parentAddDoneOpen").onclick = () => openParentTab(child.id);
  } catch (error) {
    const messages = { "bad-birth-month": `Voxie is for children aged ${MIN_CHILD_AGE} to ${MAX_CHILD_AGE}. Check the month and year.`,
      "bad-username": "Usernames are 3 to 20 letters or numbers, with no spaces (a dash is fine).",
      "username-taken": "Someone already has that username. Try adding a number or a word, like sky-77.",
      "too-short": `Make the passcode at least ${MIN_PASSCODE_LENGTH} characters.`,
      "limit": `You can add up to ${MAX_CHILDREN_PER_GROWN_UP} children.` };
    say(messages[error.message] || "Couldn't add them. Check your internet and try again.");
  }
  element("parentAddButton").disabled = false;
};
element("parentAddAnother").onclick = resetAddChildForm;
element("parentLinkForm").onsubmit = async event => {
  event.preventDefault();
  const code = element("parentLinkCode").value;
  element("parentLinkError").textContent = "";
  if (!code.trim()) { element("parentLinkError").textContent = "Type the invite code the other grown-up gave you."; return; }
  element("parentLinkButton").disabled = true;
  try {
    const child = await dataLayer.linkChildWithCode(code);
    parentChildren = [...parentChildren, child];
    await openParentTab(child.id);
  } catch (error) {
    const messages = { "bad-code": "That code isn't right, or it's run out. Ask the other grown-up to make a new one.",
      "already-linked": "You already look after that child.",
      "confusing-letters": "Codes never use 0, O, 1, I or L. Check those letters and try again." };
    element("parentLinkError").textContent = messages[error.message] || "Couldn't link. Check your internet and try again.";
  }
  element("parentLinkButton").disabled = false;
};
element("parentLogOutButton").onclick = async () => {
  try { await turnOffRemindersHere(); } catch (error) {}   // while still signed in, so the server forgets this device
  try { await dataLayer.signOut(); } catch (error) {}
  resetSessionState();
  openLogin();
};

startApp();
