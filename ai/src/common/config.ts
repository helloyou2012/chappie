/**
 * ai-platform 配置（根目录 .env，经 `bun --env-file=../.env` 加载）。
 */

export interface AiConfig {
  databaseUrl: string;
  redisUrl: string;
  internalToken: string;
  /** Rust 内部 API 基址 */
  internalBaseUrl: string;
  adminPort: number;
  modelProvider: 'mock' | 'openai-chat' | 'openai-responses' | 'anthropic';
  modelBaseUrl: string;
  modelApiKey: string;
  modelName: string;
  /** 分类小模型（缺省回退主模型） */
  classifierProvider: string;
  classifierBaseUrl: string;
  classifierApiKey: string;
  classifierModel: string;
  /** 本地意图分类服务超时（毫秒）；留空/0 表示不启用模型分类 */
  classifierTimeoutMs: number;
  /** pairwise 候选分数需超过沉默候选的最小 margin */
  classifierRankMinMargin: number;
  /** 工作群启用角色关键词匹配（无模型兜底） */
  roleMatch: boolean;
  /** 角色匹配运行时：linear=本地线性模型优先，rule=仅规则，off=关闭 */
  roleModel: 'linear' | 'mmbert' | 'rule' | 'off';
  /** 线性模型文件路径（缺省 ai/src/models/linear-pairwise.json） */
  roleModelPath: string;
  avatarDailyBudgetUsd: number;
  maxHopCount: number;
  /** 任务租约 TTL（秒）：心跳间隔续约，过期即可被恢复清扫认领 */
  taskLeaseTtlSeconds: number;
  /** 任务心跳间隔（毫秒） */
  taskHeartbeatMs: number;
  /** 恢复时效线（秒）：超过即视为过期任务直接丢弃（设计方案 §26.3） */
  recoveryStaleSeconds: number;
  /** created 状态孤儿认领宽限（秒）：覆盖存量僵尸行（lease 为 NULL） */
  recoveryCreatedGraceSeconds: number;
  /** 已决议审批续跑中断的认领宽限（秒）：避免与刚批准的正常续跑竞争 */
  recoveryApprovalGraceSeconds: number;
  /** 恢复清扫每 tick 认领上限 */
  recoveryBatch: number;
  /** 提示词历史区字符预算（有界上下文） */
  contextCharBudget: number;
  /** 单段 ReAct 循环最多工具轮次（每段独立计数；跨段由时限/段数约束） */
  maxToolRounds: number;
  /** 单段执行时间预算（秒）：超时且工作未完成 → 挂起 waiting_continuation */
  taskSegmentMaxSeconds: number;
  /** 挂起任务续驱延迟（秒）：scheduler 每隔该时间扫一次 waiting_continuation */
  continuationDelaySeconds: number;
  /** 续驱每 tick 认领上限 */
  continuationBatch: number;
  /** 长程任务整体时限（秒）：超时未完成 → 转交主人并结束 */
  longTaskMaxSeconds: number;
  /** 长程任务最大执行段数：防止快速空转刷段 */
  longTaskMaxSegments: number;
  /** 开启扩展思考（provider 支持时；思考内容仅主人可见） */
  modelThinking: boolean;
  /** 扩展思考预算（tokens） */
  thinkingBudgetTokens: number;
  /** 应用内账本初始余额（演示用，非真实资金） */
  walletInitialBalance: number;
  /** 邮件发送（Resend） */
  resendApiKey: string;
  mailFrom: string;
  /** 入站邮件 webhook 共享密钥；未配置时拒绝所有入站请求 */
  inboundEmailToken: string;
  /** 网页搜索：tavily | brave | bing | duckduckgo（默认无需 key 的 Bing） */
  webSearchProvider: 'tavily' | 'brave' | 'bing' | 'duckduckgo';
  tavilyApiKey: string;
  braveApiKey: string;
  /** 文件对象存储：配置 S3 则用 S3，否则落本地目录 */
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3ForcePathStyle: boolean;
  fileLocalDir: string;
  fileMaxBytes: number;
  /** 附件签名 URL 的 HMAC 密钥（默认复用 INTERNAL_TOKEN） */
  fileUrlSecret: string;
  /** 当前模型是否支持图片输入（多模态）；开启后会把会话图片附件传给模型 */
  modelMultimodal: boolean;
  multimodalMaxImages: number;
  multimodalMaxImageBytes: number;
  multimodalMaxTotalBytes: number;
  /** 附件消息合并窗口（毫秒）：附件后紧跟同一发送者的文本时，只由最后一条触发一次回复 */
  attachmentBurstMs: number;
  /** 自动把最近文本/PDF 附件内容注入提示词（无需模型先调 file.read） */
  fileAutoRead: boolean;
  fileAutoReadMaxFiles: number;
  fileAutoReadMaxChars: number;
  fileAutoReadMaxBytes: number;
  /** 只自动读取距当前任务这段时间内的附件，避免旧文件混入上下文 */
  fileAutoReadWindowMs: number;
  /** 合理沉默阈值：低于该置信度且满足其他条件时沉默；0 = 关闭 */
  silenceMinConfidence: number;
  /** Expo Push access token（未配置则推送降级跳过，功能不报错） */
  expoPushToken: string;
  /** Expo push 服务地址（自建/代理可覆盖） */
  expoPushUrl: string;
}

function env(key: string, def = ''): string {
  return process.env[key] ?? def;
}

export function loadConfig(): AiConfig {
  const provider = (env('MODEL_PROVIDER', 'mock') || 'mock').toLowerCase();
  const apiKey = env('MODEL_API_KEY');
  return {
    databaseUrl: env('DATABASE_URL', 'postgres://chappie:chappie@127.0.0.1:5432/chappie'),
    redisUrl: env('REDIS_URL', 'redis://127.0.0.1:6379'),
    internalToken: env('INTERNAL_TOKEN', 'dev-internal-token-change-me'),
    internalBaseUrl: env('INTERNAL_BASE_URL', 'http://127.0.0.1:7001'),
    adminPort: Number(env('ADMIN_PORT', '7002')),
    // 未配置 key 时一律降级 mock（开箱即跑）
    modelProvider: apiKey || provider === 'mock' ? (provider as AiConfig['modelProvider']) : 'mock',
    modelBaseUrl: env('MODEL_BASE_URL', 'https://api.openai.com/v1'),
    modelApiKey: apiKey,
    modelName: env('MODEL_NAME', 'gpt-4o-mini'),
    classifierProvider: env('CLASSIFIER_PROVIDER'),
    classifierBaseUrl: env('CLASSIFIER_BASE_URL'),
    classifierApiKey: env('CLASSIFIER_API_KEY'),
    classifierModel: env('CLASSIFIER_MODEL'),
    classifierTimeoutMs: Number(env('CLASSIFIER_TIMEOUT_MS', '300')),
    classifierRankMinMargin: Number(env('CLASSIFIER_RANK_MIN_MARGIN', '0')),
    roleMatch: env('AI_ROLE_MATCH', 'true') === 'true',
    roleModel: (env('AI_ROLE_MODEL', 'linear') || 'linear') as AiConfig['roleModel'],
    roleModelPath: env('AI_ROLE_MODEL_PATH'),
    avatarDailyBudgetUsd: Number(env('AVATAR_DAILY_BUDGET_USD', '1.0')),
    maxHopCount: Number(env('MAX_HOP_COUNT', '3')),
    taskLeaseTtlSeconds: Number(env('AI_TASK_LEASE_TTL_S', '120')),
    taskHeartbeatMs: Number(env('AI_TASK_HEARTBEAT_MS', '30000')),
    recoveryStaleSeconds: Number(env('AI_RECOVERY_STALE_S', '3600')),
    recoveryCreatedGraceSeconds: Number(env('AI_RECOVERY_CREATED_GRACE_S', '600')),
    recoveryApprovalGraceSeconds: Number(env('AI_RECOVERY_APPROVAL_GRACE_S', '120')),
    recoveryBatch: Number(env('AI_RECOVERY_BATCH', '5')),
    contextCharBudget: Number(env('AI_CONTEXT_CHAR_BUDGET', '6000')),
    maxToolRounds: Number(env('AI_MAX_TOOL_ROUNDS', '10')),
    taskSegmentMaxSeconds: Number(env('AI_TASK_SEGMENT_MAX_S', '240')),
    continuationDelaySeconds: Number(env('AI_CONTINUATION_DELAY_S', '5')),
    continuationBatch: Number(env('AI_CONTINUATION_BATCH', '3')),
    longTaskMaxSeconds: Number(env('AI_LONG_TASK_MAX_S', '1800')),
    longTaskMaxSegments: Number(env('AI_LONG_TASK_MAX_SEGMENTS', '8')),
    modelThinking: env('MODEL_THINKING', 'true') !== 'false',
    thinkingBudgetTokens: Number(env('MODEL_THINKING_BUDGET_TOKENS', '1024')),
    walletInitialBalance: Number(env('WALLET_INITIAL_BALANCE', '10000')),
    resendApiKey: env('RESEND_API_KEY'),
    mailFrom: env('MAIL_FROM', 'Chappie <no-reply@chappie.run>'),
    inboundEmailToken: env('INBOUND_EMAIL_TOKEN'),
    webSearchProvider: (env('WEB_SEARCH_PROVIDER', 'bing') ||
      'bing') as AiConfig['webSearchProvider'],
    tavilyApiKey: env('TAVILY_API_KEY'),
    braveApiKey: env('BRAVE_API_KEY'),
    s3Endpoint: env('S3_ENDPOINT'),
    s3Region: env('S3_REGION', 'us-east-1'),
    s3Bucket: env('S3_BUCKET'),
    s3AccessKeyId: env('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: env('S3_SECRET_ACCESS_KEY'),
    s3ForcePathStyle: env('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    fileLocalDir: env('FILE_LOCAL_DIR', '.data/files'),
    fileMaxBytes: Number(env('FILE_MAX_BYTES', String(20 * 1024 * 1024))),
    fileUrlSecret: env('FILE_URL_SECRET', env('INTERNAL_TOKEN', 'dev-internal-token-change-me')),
    modelMultimodal: env('MODEL_MULTIMODAL', 'false') === 'true',
    multimodalMaxImages: Number(env('MODEL_MULTIMODAL_MAX_IMAGES', '3')),
    multimodalMaxImageBytes: Number(
      env('MODEL_MULTIMODAL_MAX_IMAGE_BYTES', String(4 * 1024 * 1024)),
    ),
    multimodalMaxTotalBytes: Number(
      env('MODEL_MULTIMODAL_MAX_TOTAL_BYTES', String(8 * 1024 * 1024)),
    ),
    attachmentBurstMs: Number(env('AI_ATTACHMENT_BURST_MS', '1200')),
    fileAutoRead: env('AI_FILE_AUTO_READ', 'true') === 'true',
    fileAutoReadMaxFiles: Number(env('AI_FILE_AUTO_READ_MAX_FILES', '2')),
    fileAutoReadMaxChars: Number(env('AI_FILE_AUTO_READ_MAX_CHARS', '6000')),
    fileAutoReadMaxBytes: Number(env('AI_FILE_AUTO_READ_MAX_BYTES', String(8 * 1024 * 1024))),
    fileAutoReadWindowMs: Number(env('AI_FILE_AUTO_READ_WINDOW_MINUTES', '10')) * 60 * 1000,
    silenceMinConfidence: Number(env('AI_SILENCE_MIN_CONFIDENCE', '0.6')),
    expoPushToken: env('EXPO_ACCESS_TOKEN'),
    expoPushUrl: env('EXPO_PUSH_URL', 'https://exp.host/--/api/v2/push/send'),
  };
}

export const config = loadConfig();
