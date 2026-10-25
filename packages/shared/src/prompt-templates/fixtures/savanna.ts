import type {
  CharacterSheetData,
  CreatureSheetData,
  EnvironmentSheetData,
  ProductSheetData,
  ScriptPromptData,
} from "../schemas";

/** Art style as it appears on the character sheet example. */
export const CHARACTER_EXAMPLE_ART_STYLE =
  "soft painted anime illustration with a warm watercolor-and-gouache texture, gentle faceted shading built from soft angular planes of color, soft but clean painterly edges, fine thin warm-dark outlines (never heavy black lines), subtle paper-like grain, warm golden highlights and soft warm-brown and muted-violet shadows. Sharp, clean and detailed. No cel-shading, no photoreal render, no 3D look.";

export const CREATURE_EXAMPLE_ART_STYLE =
  "soft painted anime illustration with a warm watercolor-and-gouache texture, gentle faceted shading built from soft angular planes of color, soft but clean painterly edges, fine thin warm-dark outlines, subtle paper-like grain. Sharp, clean and detailed. No photoreal render, no 3D look.";

export const ENVIRONMENT_EXAMPLE_ART_STYLE =
  "soft painted anime illustration with a warm watercolor-and-gouache texture, gentle faceted shading built from soft angular planes of color, soft but clean painterly edges, fine thin warm-dark outlines, subtle paper-like grain, warm golden highlights and muted-violet shadows. Sharp, clean and detailed. No cel-shading, no photoreal render, no 3D look.";

export const PRODUCT_EXAMPLE_ART_STYLE =
  "soft painted anime illustration with a warm watercolor-and-gouache texture, gentle faceted shading, soft but clean painterly edges, fine thin warm-dark outlines, subtle paper-like grain. Sharp, clean and detailed. No photoreal render, no 3D look.";

/** Canonical project art style (unified) for live pipeline. */
export const SAVANNA_PROJECT_ART_STYLE = CHARACTER_EXAMPLE_ART_STYLE;

export const characterSheetFixture: CharacterSheetData = {
  subjectLine:
    "an original anime teenage boy, around 15 years old, a young Black savanna hunter who rides a giant cheetah",
  views: [
    "full-body front view",
    "full-body back view",
    "full-body side view",
    "a full-body view kneeling with his rifle raised and aiming",
    "plus two head close-ups (three-quarter and profile)",
  ],
  faceAndHair:
    "lean, athletic, wiry build. Deep brown skin with warm golden highlights. Short black coily hair, tapered on the sides. Sharp, focused dark-brown eyes, strong brows, a calm and serious expression. A small healed scratch across one cheekbone.",
  outfit:
    "a sleeveless, fitted vest of soft tan leather, laced up the front with thin cords. Knee-length wrap shorts of heavy woven cloth in burnt orange with thin black and cream geometric stripes along the hem, tied with a braided cord belt. A wide leather belt over it with a small pouch and a sheathed knife. A long, loose scarf of faded ochre cloth wrapped around his neck, its ends trailing behind him. Beaded bracelets in cream, turquoise and red on both wrists, and a single cord necklace with a carved bone pendant shaped like a cheetah's paw. Leather sandals with straps wrapped up to mid-calf. A leather rifle sling across his back.",
  signatureDetail: {
    heading: "TECH TOUCH",
    body: "a pair of small round goggles with amber lenses and a brass frame pushed up on his forehead, the only hint that he comes from somewhere a little ahead of his time.",
  },
  moodAndColor:
    "deep brown skin, tan leather, burnt orange, ochre, cream and turquoise accents, blending with golden savanna grass",
};

export const creatureSheetFixture: CreatureSheetData = {
  subjectLine: "a giant cheetah used as a riding mount",
  views: [
    "full-body side view",
    "full-body front view",
    "a full-body view in a full sprint",
    "a close-up of its head",
  ],
  body: "a cheetah the size of a large horse, with the classic lean, deep-chested cheetah build, long slender legs, a small head and a long tail for balance.",
  head: "a small head with intense amber eyes, alert rounded ears, and black tear lines running from the eyes to the mouth.",
  markings:
    "golden-tan coat covered in solid black spots, a cream-white belly, and a ringed black tail tip.",
  gear: {
    heading: "RIDING GEAR",
    body: "a low, lightweight leather saddle strapped around its chest, set just behind its shoulders, over a small woven saddle blanket in burnt orange, cream and turquoise geometric patterns. A simple leather harness across its chest and neck with small brass rings and a few hanging beads. Short leather reins attached to a padded brass-ringed collar, not a bit. A leather scabbard strapped along the right side of the saddle to hold a rifle.",
  },
  signatureDetail: {
    heading: "TECH TOUCH",
    body: "a few sleek brass buckles and fittings on the harness, matching the rider's goggles and rifle.",
  },
  moodAndColor:
    "golden tan, black spots, cream, warm leather, brass, and burnt orange and turquoise accents on the blanket",
};

export const environmentSheetFixture: EnvironmentSheetData = {
  place: "an African savanna",
  timeOfDay: "golden hour",
  cameraAngle: "a low angle just above the tall grass",
  theLand:
    "an endless sea of tall, golden, waist-high grass swaying in the wind, stretching to the horizon. Scattered flat-topped acacia trees with dark, spreading canopies. A large rocky outcrop of rounded, sun-warmed boulders on one side. Dusty red-earth trails winding through the grass. In the middle distance, a wide, slow river cuts across the plain, its muddy banks steep and cracked, the water a murky olive-brown, with a few half-submerged logs and reeds along the edges.",
  skyAndLight:
    "a huge, open sky shading from deep apricot near the horizon to soft violet above, with long, streaky clouds lit gold and pink. A low, blazing sun near the horizon casts long shadows and makes the grass glow. Faint dust hangs in the air, catching the light.",
  moodAndColor:
    "golden grass, red earth, dark acacia greens, olive river water, apricot and violet sky",
};

export const productSheetFixture: ProductSheetData = {
  objectName: "hunting rifle",
  views: "two views: a full side view and a three-quarter view from above",
  theObject: {
    heading: "THE RIFLE",
    body: "a long-barreled precision hunting rifle that looks handmade from savanna materials but is subtly futuristic. The stock and grip are carved from dark, polished hardwood with fine geometric patterns carved into it. The grip and forend are wrapped in tan leather cord with a band of cream, turquoise and red beadwork. The barrel is long, slim and made of a sleek, matte cream-white ceramic-like material with thin brass rings along its length and small vent slits near the muzzle. The receiver is smooth brass with softly glowing thin amber lines along its sides. A long brass scope with a large amber lens at the front and a leather eye cup at the back sits on top. A folding bipod tucked under the barrel. A leather sling with brass clips.",
  },
  feel: "it should blend naturally with a traditional savanna hunter's gear through its wood, leather, beads and brass, while its sleek barrel, glowing lines and scope quietly suggest technology from the future.",
  moodAndColor:
    "dark wood, cream-white, brass, tan leather, amber glow and small beadwork accents",
};

/** Partial script fixture focused on structure; full example is large. */
export const scriptPromptFixture: ScriptPromptData = {
  references: [
    {
      imageN: 1,
      entityId: "boy",
      entityLabel: "the boy",
      useFor:
        "Use it for his exact face, hair, scar, goggles, scarf, clothing, gear and proportions from every angle.",
    },
    {
      imageN: 2,
      entityId: "cheetah",
      entityLabel: "the giant cheetah",
      useFor:
        "Use it for its exact body, spots, face, saddle, blanket, harness, beads and rifle scabbard.",
    },
    {
      imageN: 3,
      entityId: "savanna",
      entityLabel: "the savanna",
      useFor:
        "Use it for the exact golden grassland, acacia trees, rocky outcrop, red-cliffed river, fallen log, distant mountains and sunset sky.",
    },
    {
      imageN: 4,
      entityId: "rifle",
      entityLabel: "the rifle",
      useFor:
        "Use it for its exact carved wooden stock, leather and bead wraps, brass receiver with glowing amber line, cream-white barrel, brass scope and sling.",
    },
    {
      imageN: 5,
      entityId: "antelope",
      entityLabel: "the hybrid antelope",
      useFor:
        "Use it for the exact look of every antelope in the herd, including the one being hunted.",
    },
    {
      imageN: 6,
      entityId: "croc-shark",
      entityLabel: "the crocodile-shark",
      useFor: "Use it for the exact creature in the river.",
    },
  ],
  artStyleBlock:
    "soft painted anime illustration with a warm watercolor-and-gouache texture, gentle faceted shading built from soft angular planes of color, soft but clean painterly edges, fine thin warm-dark outlines (never heavy black lines), subtle paper-like grain, warm golden highlights and muted-violet shadows.",
  artStyleExtras:
    "Fur, grass, dust and water spray are painted as layered, leaf-like tufts and strokes, exactly as in the references. This applies to everything: the boy, cheetah, antelope, crocodile-shark, rifle, grass, trees, river, sky, dust, splashes and muzzle flash.",
  imageQuality:
    "Every frame sharp, crisp and clean. Faces, eyes, hands, fur and the rifle stay in sharp focus and clearly readable, even at full sprint. Motion is shown with painted speed streaks and flying grass in the background only; the boy, cheetah and target antelope are never blurred or smeared. No noise, no flicker, no warping, no melting shapes, no ghosting between frames.",
  castBlocks: [
    {
      name: "boy",
      imageN: 1,
      suffix: ", identical in every shot",
      description:
        "A lean teenage boy with deep brown skin, short coily black hair on top with faded sides, dark-brown eyes, strong brows and a small X-shaped scar on his cheek. A brass-framed pair of goggles with amber lenses on a leather strap across his forehead. A long, tattered mustard-yellow scarf around his neck. A tan leather vest laced up the front, a leather strap across his chest, a belt with pouches and a sheathed knife. A burnt-orange wrap skirt-shorts with black-and-cream geometric trim and hanging cord tassels. Beaded bracelets in turquoise, cream and red, a bone pendant shaped like a paw print, and leather sandals cross-strapped up to his calves.",
    },
    {
      name: "cheetah",
      imageN: 2,
      suffix: "",
      description:
        "a horse-sized cheetah with a golden, black-spotted coat, cream belly, black tear lines and amber eyes. A brown leather saddle over a red, cream and teal geometric blanket, a leather harness with brass rings, hanging teal and red beads and brass coin charms, short reins, and a leather rifle scabbard on its right side.",
    },
    {
      name: "rifle",
      imageN: 4,
      suffix: "",
      description:
        "a long hunting rifle with a dark carved wooden stock with geometric diamond patterns and a brass butt plate, leather-wrapped grip and forend with bands of cream, turquoise and red beads, a brass receiver with a softly glowing amber line, a long cream-white barrel with brass rings and a vented muzzle, a brass scope with a glowing amber front lens and a leather eye cup, and an embossed leather sling.",
    },
    {
      name: "antelope",
      imageN: 5,
      suffix: ", every one in the herd",
      description:
        "slender antelope with a shaggy dark plum-violet back, coral-red sides, curving teal stripes, cream legs and belly, a dark tufted tail, long ridged lyre-shaped horns, amber eyes, a golden mane and beard, and a mandrill-like face with bright blue ridged cheeks and a red nose.",
    },
    {
      name: "crocodile-shark",
      imageN: 6,
      suffix: "",
      description:
        "a huge creature with an armored olive-brown crocodile back, a tan belly, black shark gill slits, a tall notched shark dorsal fin, a crescent shark tail, rows of large jagged ivory teeth, flat black eyes, old pink scars, hanging weed and a broken spear lodged in its back.",
    },
  ],
  location: {
    imageN: 3,
    description:
      "golden savanna at sunset, tall grass swaying, acacia trees, a rocky outcrop, and a river running between red earth cliffs, low sun and a violet-and-apricot sky. No readable text, no logos, no brand names anywhere.",
  },
  totalDurationSec: 30,
  aspectRatio: "16:9",
  multiShot: true,
  shots: [
    {
      n: 1,
      startSec: 0,
      endSec: 1.5,
      shotType: "Extreme wide shot",
      cameraMove: "slow drift forward",
      action:
        "the @image_3 savanna at sunset, golden grass rippling in the wind; far off, a herd of @image_5 antelope grazes near the acacias.",
    },
    {
      n: 2,
      startSec: 1.5,
      endSec: 3.0,
      shotType: "Close-up",
      action:
        "a single antelope grazing, its blue-and-red mandrill face chewing a mouthful of golden grass, ears flicking, amber eyes calm.",
    },
    {
      n: 3,
      startSec: 3.0,
      endSec: 4.0,
      shotType: "Extreme close-up",
      cameraMove: "low in the grass",
      action:
        "blades part slightly, revealing @image_1's eyes watching, perfectly still, amber goggles on his forehead.",
    },
  ],
  consistency:
    "The art style of all six references never changes. The boy's face, hair, scar, goggles, scarf and clothing stay identical in every shot, with the goggles on his forehead until Shot 12 and over his eyes from Shot 12 onward. The cheetah, rifle, antelope and crocodile-shark always match their references. The hunted antelope is always the same individual after Shot 13. The crocodile-shark only shows its fin before Shot 17. No gore and nothing graphic at any point.",
  motionAndPhysics:
    "The cheetah runs with a real cheetah's gait: its spine flexing and extending with each bound, its tail swinging for balance through turns. The boy moves with the cheetah's rhythm, crouched low and balanced. The antelope bound and zigzag with light, springy leaps. Grass, dust and water spray react with realistic weight. The scarf, tassels, beads and harness charms whip in the wind. The river eruption throws heavy sheets of water that fall back realistically.",
  lighting:
    "Warm golden sunset light throughout, long shadows across the grass, the sun low behind the action in the wide shots. The rifle's amber glow and the scope's amber tint stand out in the final shots.",
  technical:
    "16:9, 24fps, highest available resolution, sharp and clean painted illustrated look matching the references, no subtitles, no on-screen text, no logos, no watermark.",
  music:
    "Tense, epic savanna score: begins almost silent, with a low string drone, soft kalimba notes and a faint heartbeat on a talking drum. After the shot into the air, it bursts into driving, galloping hand drums, djembes and shakers with soaring strings and a bold horn line that builds through the chase. It cuts to a breath of silence as the jaws erupt from the river, crashes back in on the landing, then fades away completely from Shot 21 to leave only wind and breathing.",
  audioIntro: "AUDIO (native sound, synced to picture, no dialogue):",
  audioCues: [
    {
      atSec: 0,
      description: "wind in the grass, distant bird calls, a low drone.",
    },
    {
      atSec: 1.5,
      description: "close, crunchy chewing and a soft snort.",
    },
    {
      atSec: 3.0,
      description: "his slow breathing, grass rustling.",
    },
  ],
};

/** Worked example shots from the plan (SHOT 03 and SHOT 22). */
