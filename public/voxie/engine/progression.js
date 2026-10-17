/* ======================================================================
   engine/progression.js  —  worked out from the registered content, so it loads after content/loader.js
   has added every item, pet and location: buddy options, level rewards, level points.
   ====================================================================== */
const PET_OPTIONS = PET_ORDER.map(petType => ({ id: petType, label: PET_TYPES[petType].label, unlockLevel: 1 }));

/* House items live in the House tab, not the Inventory. */
const isHouseItem = itemId => (getInventoryItem(itemId) || {}).category === "house";
/* Pets from the Inventory follow the main pet to every location. */
const isCompanionPet = itemId => (getInventoryItem(itemId) || {}).category === "pets";
const BIGGER_BUDDY_LEVEL = 5;
/* Tasks a child adds themselves: each is worth 1 point like a set task.
   Capped per day so the game can't be farmed for points. */
/* The most tasks a child can have in one day, counting set tasks, scheduled tasks and their own. */
const MAX_TASKS_PER_DAY = 10;
/* Passcodes: at least this many characters (Supabase's minimum password length must match). */
const MIN_PASSCODE_LENGTH = 6;
/* A grown-up gives each child's birth MONTH AND YEAR (never a full date of birth, real name, email or gender). It's
   collected ONLY to pick missions that suit the child's age, which is worked out each day so missions grow with them.
   The birth year can be from MAX_CHILD_AGE to MIN_CHILD_AGE years ago. */
const MIN_CHILD_AGE = 4, MAX_CHILD_AGE = 16;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/* Timed missions start switched off for a child under this age: a 5–7 year old may need someone to read to them. */
const TIMED_MISSIONS_FROM_AGE = 8;
const MAX_MISSIONS_PER_DAY = 3;
/* Scheduled tasks: repeat on chosen days, up to MAX_TIMES_PER_DAY times a day (e.g. brush teeth twice). */
const MAX_SCHEDULED_TASKS = 15;
const MAX_TIMES_PER_DAY = 4;
const WEEK_DAYS = [
  { id: "mon", short: "M", label: "Mon" }, { id: "tue", short: "T", label: "Tue" }, { id: "wed", short: "W", label: "Wed" },
  { id: "thu", short: "T", label: "Thu" }, { id: "fri", short: "F", label: "Fri" }, { id: "sat", short: "S", label: "Sat" }, { id: "sun", short: "S", label: "Sun" }
];
const SCHOOL_DAYS = ["mon", "tue", "wed", "thu", "fri"], WEEKEND_DAYS = ["sat", "sun"];
function getWeekDayIdInUk(isoDate) { return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(isoDate + "T12:00:00Z").getUTCDay()]; }
const lookRewards = (options, suffix, kind) => options.filter(option => option.unlockLevel > 1)
  .map(option => ({ level: option.unlockLevel, label: `${option.label} ${suffix}`, kind }));
/* What each level gives. Rebuilt whenever the playing buddy changes, because each buddy unlocks things in its own order. */
const buildLevelRewards = () => [
  ...INVENTORY_ITEMS.filter(item => item.unlockLevel !== undefined).map(item => ({ level: item.unlockLevel, label: item.label, kind: item.category === "house" ? "house" : "item", category: item.category, itemId: item.id })),
  { level: BIGGER_BUDDY_LEVEL, label: "a bigger buddy", kind: "growth" },
  ...lookRewards(BODY_COLOURS, "colour", "look"), ...lookRewards(FACES, "face", "look"),
  ...lookRewards(ARM_POSES, "arms", "look"), ...lookRewards(BODY_WIDTHS, "body", "look"),
  ...lookRewards(BODY_HEIGHTS, "body", "look"), ...lookRewards(LOCATIONS, "location", "location")
].sort((first, second) => first.level - second.level);
let LEVEL_REWARDS = buildLevelRewards();

/* ---------- Each buddy's own unlock order and Shop ----------
   The server deals every buddy its own order when it's made (buddy_unlocks, buddy_shop): items, places and looks
   above level 1 swap levels with others of the same kind. Its Shop sells 12 of the Shop items, a different 12 for
   every buddy and a new 12 every Monday (the server picks them: private.shop_this_week).
   applyBuddyDeals() sets each option's unlockLevel to the playing buddy's, so the rest of the game just reads
   unlockLevel as before. The levels in the content files are kept, for anything the deal doesn't mention. */
const CONTENT_UNLOCK_LEVELS = new WeakMap();
const DEALT_OPTION_LISTS = () => ({ item: INVENTORY_ITEMS, location: LOCATIONS, "body-colour": BODY_COLOURS, face: FACES,
  arms: ARM_POSES, width: BODY_WIDTHS, height: BODY_HEIGHTS });
let buddyShopThisWeek = new Set();   // the playing buddy's Shop items this week
let buddyShopRestocksOn = null;      // "YYYY-MM-DD": the Monday the Shop changes
function applyBuddyDeals({ unlockLevels = {}, shopThisWeek = [], shopRestocksOn = null } = {}) {
  Object.entries(DEALT_OPTION_LISTS()).forEach(([kind, options]) => options.forEach(option => {
    if (!CONTENT_UNLOCK_LEVELS.has(option)) CONTENT_UNLOCK_LEVELS.set(option, option.unlockLevel);
    const contentLevel = CONTENT_UNLOCK_LEVELS.get(option);
    if (contentLevel === undefined) return;   // not a level unlock (Shop or chance items)
    option.unlockLevel = (unlockLevels[kind] || {})[option.id] ?? contentLevel;
  }));
  buddyShopThisWeek = new Set(shopThisWeek);
  buddyShopRestocksOn = shopRestocksOn;
  LEVEL_REWARDS = buildLevelRewards();
}
/* Does the playing buddy's Shop sell this, this week? */
const inBuddyShop = item => item.xpPrice !== undefined && buddyShopThisWeek.has(item.id);
/* Level points come ONLY from tasks (1 per task ticked). Points needed to REACH each level:
   level 2 after 2 tasks, level 3 after 4 more, level 4 after 5 more. After that each level costs
   POINTS_PER_LEVEL_AFTER_LAST, plus 1 more task for every LEVELS_PER_EXTRA_TASK levels, never more than
   MAX_POINTS_PER_LEVEL. So levels get slowly harder but never feel stuck:
   levels 5–29: 4 tasks each · 30–54: 5 · 55–79: 6 · 80–104: 7 · … up to 10.
   Level 100 (a rebirth) = 530 tasks: about 3 months at 6 tasks a day. A new buddy starts back at the quick levels.
   Every MILESTONE_EVERY_LEVELS levels also gives a free Mystery box, so high levels always have something coming.
   Missions give XP instead, which is a separate currency to spend. */
const LEVEL_POINT_THRESHOLDS = [0, 2, 6, 11];
const POINTS_PER_LEVEL_AFTER_LAST = 4;
const LEVELS_PER_EXTRA_TASK = 25;
const MAX_POINTS_PER_LEVEL = 10;
const MILESTONE_EVERY_LEVELS = 10;
function pointsToGoUpFrom(level) {   // tasks from `level` to `level + 1`, for levels after the threshold list
  return Math.min(MAX_POINTS_PER_LEVEL, POINTS_PER_LEVEL_AFTER_LAST + Math.max(0, Math.floor((level - 5) / LEVELS_PER_EXTRA_TASK)));
}
const levelPointCache = [...LEVEL_POINT_THRESHOLDS];
function pointsNeededForLevel(level) {
  while (levelPointCache.length < level) {
    const previousLevel = levelPointCache.length;
    levelPointCache.push(levelPointCache[previousLevel - 1] + pointsToGoUpFrom(previousLevel));
  }
  return levelPointCache[level - 1];
}
function calculateLevel(points) {
  let level = 1;
  while (pointsNeededForLevel(level + 1) <= points) level++;
  return level;
}
function getInventoryItem(itemId) { return INVENTORY_ITEMS.find(item => item.id === itemId); }
