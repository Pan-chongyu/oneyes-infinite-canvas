// User-facing video errors are generated here, never copied from a service body.
export const videoErrorMessages = {
    unknown: '视频处理暂未完成，请稍后查看任务或联系支持。',
    service_unavailable: '视频服务暂时不可用，请稍后重试或切换模型。',
    creation_outcome_unknown: '提交结果尚未确认，已保留恢复记录，请勿重复生成。',
    content_policy: '参考素材未通过内容审核，请更换素材或调整提示词后重新提交。',
    duration_invalid: '当前模型不支持所选时长，请按参数面板中该模型允许的时长调整；原设置已保留。',
    resolution_invalid: '当前模型不支持所选分辨率或画面比例，请调整参数面板中的设置；原分辨率已保留。',
    reference_1080: '当前参考模式不支持 1080p，请主动选择支持的配置；已保留所选分辨率。',
    minimax_resolution: '当前模型仅支持 768p / 1080p / 2K，请在参数面板主动选择；原分辨率已保留。',
    material_count: '参考素材数量超过当前模型限制，请按参数面板减少素材后重新提交。',
    material_conflict: '参考素材设置重复或冲突，请检查首尾帧和参考图片。',
    reference_identity: '同一参考素材 ID 指向不同文件，请重新选择素材；未提交生成。',
    reference_required: '当前模型需要参考图片，请先添加图片。',
    reference_upload_required: '参考素材尚未上传完成或无法读取，请重新选择或上传素材后再提交。',
    unsupported_media: '视频请求或素材格式不受支持（415），请更新客户端并重新选择受支持的素材格式。',
    media_too_large: '当前模型或访问入口拒绝了素材大小，请检查模型单文件限制或减少素材；未自动重发，不会降低画质或更改接口地址。',
    inline_text_too_large: '内联文本或 Base64 素材超过 32 MiB，请使用二进制文件 part 或受支持的预上传素材；未自动重新生成，不会降低画质。',
    bridge_request_too_large: '视频请求正文超过 128 MiB（含封装开销），请减少素材或使用受支持的预上传入口；模型单文件与 CDN 限制独立生效，未自动重发或更改站点地址。',
    watermark_invalid: '水印开关参数无效，请在参数面板重新选择开启或关闭。',
    parameters_invalid: '视频参数不受支持（422），请检查时长、分辨率、比例和素材模式；参数已保留，不会自动重新提交。',
    model_not_allowed: '当前 API Key 无权调用该模型，请刷新模型列表并检查官网 Key 分组权限；不会自动换 Key、分组或放宽模型权限。',
    model_missing: '当前 API Key 的可用模型列表不包含所选模型，请刷新模型列表并检查官网分组权限；不会自动换 Key、分组或付费模型。',
    model_unavailable: '当前视频模型暂不可用，请刷新模型列表或选择其他可用模型。',
    task_missing: '找不到任务（404），请核对官网任务和用量并联系支持；原记录已保留，请不要反复生成。',
    task_expired: '原视频任务已过期（410），请核对官网任务和用量并联系支持；不会自动重新生成。',
    not_found: '视频接口或任务暂不可用（404），请检查所选模型、Key 分组和官网任务记录；不会自动重新生成。',
    credentials: '原任务凭据不可用，请重新登录或恢复原 API Key 后重试；原任务已保留。',
    waiting: '暂时无法获取任务进度，网络恢复后继续查询原任务，不会重新生成。',
    download: '视频结果取回未完成，原任务已保留，可继续恢复；不会重新生成。',
    save_error: '视频保存未完成，请检查磁盘空间和目录权限后重试；原任务已保留。',
    confirmation: '请确认当前登录账号为原提交账号，再恢复原任务；不会重新生成。',
    not_submitted: '素材排队等待已中断，尚未提交生成；原请求记录已保留，不会自动重新提交。',
    throttled: '素材处理繁忙，尚未提交生成，正在按服务器要求等待。',
    cancelled: '已取消本次等待；已提交的任务保留在视频任务中。',
    node_deleted: '视频节点已删除，已停止提交。',
};

/** Only a site response header is evidence of a site request ID; never body IDs.
 * @param {string} url @param {{get?: (name: string) => unknown, [key: string]: any}} headers */
export function videoSiteRequestId(url, headers) {
    if (!/^https:\/\/(?:api\.)?oneyes\.ai(?:\/|$)|^oneyes-canvas:\/\/app\/oneyes-api(?:\/|$)/i.test(url)) return;
    const id = headers.get?.('x-request-id') ?? headers['x-request-id'] ?? headers['X-Request-Id'];
    return typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ? id : undefined;
}

/** @param {unknown} value @param {{state?: string, stage?: string, status?: number, requestId?: string}} [context] */
export function videoErrorText(value, context = {}) {
    const error = value && typeof value === 'object' ? /** @type {any} */ (value) : {};
    const response = error.response;
    let payload = response?.data ?? value;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { /* Only classify text, never return it. */ } }
    const data = payload && typeof payload === 'object' ? /** @type {any} */ (payload) : {};
    const detail = Array.isArray(data.detail) ? data.detail : [];
    const texts = [typeof payload === 'string' ? payload : '', data.message, data.msg, typeof data.error === 'string' ? data.error : data.error?.message, typeof data.detail === 'string' ? data.detail : '', ...detail.map(item => item?.msg)].filter(item => typeof item === 'string' && item.trim());
    const text = texts.join(' ');
    const code = String(data.error?.code ?? data.code ?? '').toLowerCase();
    const status = context.status ?? response?.status ?? error.status;
    // An already generated message may cross IPC, storage or a display boundary.
    // Match the complete message and a strictly validated site ID, never a prefix.
    const existing = text.match(/^(.*?)(?:\n本站请求编号：([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))?$/i);
    const canonical = Object.values(videoErrorMessages).includes(existing?.[1]) ? existing[1] : undefined;
    let kind = 'unknown';
    if (error.name === 'AbortError' || error.name === 'CanceledError') kind = 'cancelled';
    else if (code === 'creation_outcome_unknown' || context.state === 'unknown' || /未取得可靠(?:任务|回执)|no video task|no task id|(?:creation|submission) outcome is unknown|task id could not be confirmed|video was submitted but (?:its response could not be verified|.*receipt could not be saved)|提交结果(?:不确定|尚未确认)/i.test(text)) kind = 'creation_outcome_unknown';
    else if (/quota|balance|credit|insufficient|余额|积分|额度|欠费/i.test(code + ' ' + text)) kind = 'service_unavailable';
    else if (context.state === 'confirmation') kind = 'confirmation';
    else if (context.state === 'not_submitted') kind = 'not_submitted';
    else if (context.state === 'throttled') kind = 'throttled';
    else if (code === 'model_not_allowed' || /model[_ ]not[_ ]allowed|模型.*(?:未获准|无权限|未允许)/i.test(text)) kind = 'model_not_allowed';
    else if (/可用模型列表不包含/.test(text)) kind = 'model_missing';
    else if (code === 'model_unavailable' || /(?:model|模型).{0,40}(?:temporarily unavailable|is not available|暂(?:时)?不可用)/i.test(text)) kind = 'model_unavailable';
    else if (code === 'content_policy' || /moderation|content.?policy|可识别人物|真人|未通过.*审核/i.test(text)) kind = 'content_policy';
    else if (code === 'inline_text_too_large') kind = code;
    else if (code === 'bridge_request_too_large') kind = code;
    else if (code === 'media_too_large' || code === 'material_too_large' || status === 413 || /超过.*(?:MiB|字节|单文件限制)/i.test(text)) kind = 'media_too_large';
    else if (code === 'task_not_found' || context.state === 'missing' || /task[_ ]not[_ ]found/i.test(text)) kind = 'task_missing';
    else if (context.state === 'expired' || status === 410) kind = 'task_expired';
    else if (context.state === 'credentials') kind = 'credentials';
    else if (context.state === 'save_error' || ['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EIO'].includes(error.code)) kind = 'save_error';
    else if (context.state === 'download_error' || context.stage === 'download') kind = 'download';
    else if (code === 'material_conflict' || /Duplicate or conflicting|Conflicting.*frame|参考素材.*(?:冲突|重复)/i.test(text)) kind = 'material_conflict';
    else if (/同一参考素材 ID/.test(text)) kind = 'reference_identity';
    else if (code === 'material_count' || /too many.*(?:image|video|audio)|素材.*(?:数量|合计最多)|最多.*(?:参考|图片|音频|视频)/i.test(text)) kind = 'material_count';
    else if (/1080p.*not supported.*reference-to-video|不支持参考模式的 1080p|参考模式.*不支持.*1080p|多参考素材仅支持 480p \/ 720p|尾帧仅支持 480p \/ 720p/is.test(text)) kind = 'reference_1080';
    else if (/^该模型支持 768p \/ 1080p \/ 2K，请主动选择支持的分辨率；已保留原设置。$/.test(text)) kind = 'minimax_resolution';
    else if (code === 'duration_invalid' || /duration.{0,80}(?:invalid|outside|out of range|unsupported|not supported)|(?:invalid|unsupported).{0,30}duration|时长.{0,20}(?:不支持|超出|超范围|无效)|不支持.{0,10}时长|支持 [\d /–.-]+ 秒|固定 \d+ 秒|最多支持 \d+ 秒/i.test(text)) kind = 'duration_invalid';
    else if (code === 'resolution_or_ratio_invalid' || /(?:unsupported|invalid).{0,30}(?:resolution|aspect.?ratio)|(?:resolution|aspect.?ratio).{0,30}(?:unsupported|not supported|invalid)|(?:分辨率|画幅比例|像素尺寸).{0,20}(?:不支持|无效|不符)|(?:不支持|仅支持).{0,20}(?:分辨率|比例)|请(?:主动选择支持的分辨率|调整画幅比例)/i.test(text)) kind = 'resolution_invalid';
    else if (/watermark|水印开关参数无效/i.test(text)) kind = 'watermark_invalid';
    else if (/需要(?:至少一张)?参考图片|requires an input image/i.test(text)) kind = 'reference_required';
    else if (code === 'reference_upload_required' || /素材.*(?:上传|读取)|参考.*(?:损坏|解码|无法|HTTPS)|invalid image data/i.test(text)) kind = 'reference_upload_required';
    else if (status === 415 || /(?:status|HTTP)\s*415\b/i.test(text)) kind = 'unsupported_media';
    else if (code === 'unsupported_field' || status === 422 || /参数.{0,15}(?:无效|不支持|冲突)|首尾帧不能|仅支持参考模式|固定生成音频/i.test(text)) kind = 'parameters_invalid';
    else if (status === 404) kind = 'not_found';
    else if (/视频节点已删除/.test(text)) kind = 'node_deleted';
    else if (context.stage === 'poll' && (!status || status === 408 || status === 429 || status >= 500) || context.state === 'waiting') kind = 'waiting';
    // No balance-specific UI is inferred here: these responses are not proof of
    // site billing ownership, even when a service uses INSUFFICIENT_BALANCE.
    const message = canonical || videoErrorMessages[kind];
    const id = context.requestId ?? existing?.[2];
    return message + (typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ? '\n本站请求编号：' + id : '');
}
