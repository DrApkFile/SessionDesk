export const REGULAR_MIN_ACTIVE_DAYS = 3;
export const CONTRIBUTOR_MIN_POINTS = 10;
export const POINTS_PER_CONTRIBUTION = { helped: 2, valid_report: 3 } as const;
export const HELPED_PER_PAIR_PER_DAY = 1;

export const RECALL_LIMIT = 100;
export const NAMESPACE_ROLLOVER_AT = 90;

export const WRITE_TIMEOUT_MS = 60_000;
export const WRITE_ATTEMPTS = 3;
export const WRITE_RETRY_BACKOFF_MS = [2_000, 8_000] as const;

export const BUDGET_WINDOW_MS = 60 * 60 * 1000;
export const BUDGET_POINTS_PER_WINDOW = 500;
export const POINTS_PER_REMEMBER = 5;
export const POINTS_PER_RECALL = 1;

export const PROMISE_MAX_DAYS_AHEAD = 30;
export const FOLLOWUP_CHECK_MINUTES = 30;
export const THEME_WINDOW_DAYS = 7;
export const HELPERS_WINDOW_DAYS = 30;

export const MODEL_ATTEMPTS = 3;
export const MODEL_RETRY_BACKOFF_MS = [1_000, 4_000] as const;

export const MAX_STORED_TEXT_CHARS = 1_000;
export const MAX_THEME_LABEL_CHARS = 40;

export const BUDGET_PAUSE_RECHECK_MS = 60_000;
export const WRITE_PAUSE_LIMIT = 30;
export const NAMESPACE_PAGE_LIMIT = 200;
export const LEDGER_RECALL_QUERY = "SD1 community ledger event";

export const GEMINI_RETRY_WINDOW_MINUTES = 5;
export const PENDING_RETRY_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const;
export const PENDING_MAX_ATTEMPTS = 8;
export const PENDING_BUFFER_LIMIT = 200;

export const CONFLICT_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const;
export const POLLING_RESTART_BACKOFF_MS = 10_000;
export const SHUTDOWN_DRAIN_SECONDS = 25;
export const DRAIN_POLL_MS = 500;
export const DEFAULT_PORT = 3000;

export const ANSWER_MAX_DISTANCE = 0.56;
export const MIN_REUSE_CONTENT_WORDS = 2;
export const PENDING_ANSWERS_OFFERED = 5;
export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const DISCORD_MESSAGE_LIMIT = 2000;
export const SLACK_MESSAGE_LIMIT = 3000;
export const THEMES_SHOWN = 12;
export const ANSWER_SEARCH_LIMIT = 5;
export const KNOWN_ISSUE_MAX_DISTANCE = 0.5;
export const KNOWN_ISSUE_SEARCH_LIMIT = 5;
export const PLAIN_RECALL_TOP_K = 5;

export const ANSWER_FEEDBACK_WINDOW_MINUTES = 30;

export const MYDATA_TEXT_CHARS = 160;

export const NETWORK_NAMES = ["mainnet", "testnet", "devnet", "localnet", "staging", "sandbox", "prod", "production"] as const;

export const TICKER_WORDS = ["near","link","dot","ton","arb","apt","trx","op"] as const;

export const DEVICE_NAMES = ["android", "ios", "iphone", "ipad", "windows", "macos", "mac", "linux", "web", "desktop", "mobile", "tablet", "chrome", "safari", "firefox", "edge"] as const;

export const COMMON_WORDS = [
  "a","able","about","above","accept","accepted","accepts","access","account","accounts","across","actually","add","added","adding","address","addresses","affect","affected","affects","after","again","against","ago","all","allowed","anymore","anyway","available","allow","allowed","already","also","always","am","an","and","another","answer","answered","any","anybody","anyone","anything","app","apps","are","around","as","ask","asked","asking","at","away",
  "back","bad","balance","be","browser","build","because","been","before","being","below","best","better","between","both","bring","broke","broken","bug","but","button","buy","by",
  "call","called","can","cannot","cant","card","cards","care","case","cash","chain","chains","change","changed","changes","charge","charged","chat","check","checked","checkout","clear","clears","click","clicked","close","closed","code","colleague","come","comes","coming","company","confirm","confirmed","connect","connected","connection","contact","cost","could","create","created","customer",
  "data","date","day","days","delete","deleted","detail","details","device","did","different","disable","disabled","do","does","doing","done","dont","down","download","due","during",
  "each","earlier","early","edit","either","else","email","emails","end","enough","enter","entered","error","errors","even","eventually","ever","every","everyone","everything","exactly","example","expect","expected",
  "fail","failed","failing","fails","far","fast","feature","fee","fees","few","file","fill","find","fine","first","fix","fixed","fixing","follow","for","forget","forgot","forgotten","form","free","friend","from","full",
  "get","gets","getting","give","given","go","goes","going","gone","good","got","group",
  "had","happen","happened","happening","happens","has","have","having","he","help","helped","her","here","him","his","hold","home","how","however",
  "i","if","im","in","info","information","input","instead","internet","into","invite","invited","invitation","is","issue","it","its","ive",
  "join","joined","just",
  "keep","keeps","kept","key","know","known","knows",
  "language","last","late","later","least","leave","left","less","let","like","limit","line","link","list","little","live","load","loading","log","login","long","look","looking","lose","lost","lot",
  "made","mail","main","make","makes","making","many","may","maybe","me","mean","means","member","members","message","messages","might","mine","minute","minutes","miss","missing","mistake","mode","money","month","more","most","move","much","must","my",
  "name","near","need","needed","needs","neither","network","never","new","news","next","nice","no","nobody","none","not","note","nothing","now","number",
  "of","off","offline","often","ok","okay","old","on","once","one","online","only","onto","open","opened","option","options","or","order","orders","other","others","our","out","over","own",
  "page","paid","part","pass","password","pay","payment","payments","people","per","phone","pick","place","plan","please","pls","point","points","possible","post","press","price","probably","problem","process","put",
  "question","questions","quick",
  "rather","read","ready","real","really","reason","receive","received","refund","register","remove","removed","reply","report","reported","request","reset","rest","right","run","running",
  "same","save","saved","say","says","screen","simply","somehow","supported","supporting","supports","second","see","seen","select","send","sent","service","set","setting","settings","share","shared","should","show","shows","side","sign","signal","signin","signup","since","site","slow","so","some","somebody","someone","something","soon","sorry","sort","start","started","state","status","stay","step","still","stop","stopped","such","support","sure","switch","sync","syncs","system",
  "take","takes","team","tell","test","tested","testing","token","tokens","than","thank","thanks","that","the","their","them","then","there","these","they","thing","things","think","this","those","though","three","through","time","times","to","today","told","too","took","top","total","transfer","try","trying","turn","two","type",
  "under","understand","until","up","update","updated","upgrade","upgraded","upload","us","use","used","user","users","using","usually",
  "value","version","very","via","view",
  "wait","waiting","wallet","wallets","want","wanted","was","way","we","week","weeks","well","went","were","what","whatever","when","where","whether","which","while","who","why","will","with","within","without","wont","word","work","worked","working","works","workspace","would","write","wrong",
  "year","years","yes","yet","you","your","yours",
] as const;
