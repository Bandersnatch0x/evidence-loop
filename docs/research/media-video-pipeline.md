# 上传媒体、外链视频与转码架构调研

> 调研日期：2026-07-31  
> 适用范围：当前 Node.js + SQLite 单体原型，以及不推翻 v1 数据模型的生产演进路径  
> 证据范围：官方规范、官方产品文档、第一方源码仓库；所有外部链接访问日期均为 2026-07-31

## 0. 结论速览

v1 应采用一条统一、可恢复、可隔离的媒体链路：

1. **所有平台托管媒体走独立 tus 上传端点**，不进入现有 JSON body 解析器。浏览器先创建有配额预留的 `UploadSession`，再用 `PATCH` 续传；tus 用 `HEAD`/`Upload-Offset` 恢复上传，并定义了分块校验与过期扩展，适合图像、音频、GLB 和视频共用一套协议。[tus 1.0.x 协议](https://tus.io/protocols/resumable-upload)
2. **保留现有 SHA-256 内容寻址契约**，但上传期间只写随机临时文件。完成后由服务端流式计算 SHA-256、识别真实类型、扫描和解析；通过后才原子落入 `data/media/<hash>.<canonical-ext>`。原始文件和每个派生文件都是不可变 blob，版本只引用具体 hash。
3. **SQLite 只存元数据、上传会话、配额预留和持久化作业**；blob 仍在文件系统。单体内部运行有租约的低并发 worker，进程重启后可续跑。`BlobStore`、`UploadStore`、`MediaProcessor` 三个接口从第一天存在，使生产期能分别替换为 S3 兼容存储、直传和独立 worker。
4. **上传完成不等于可用**。状态必须经过 `uploading -> quarantined -> inspecting -> processing -> ready`，任何一步都可进入 `rejected`/`failed`。草稿可以显示处理进度；有非 `ready` 媒体的候选版本不得提交审核。
5. **v1 不做视频编辑，也不先做 HLS**。对获许可的 FFmpeg 构建，生成一个受限的 MP4 播放版本和一张封面；保留原始 blob。章节、封面和播放区间是作品元数据。自动字幕、ABR/HLS、多码率转码和 3D 服务端渲染延后。
6. **外链视频不是不可变媒体 blob**。它必须建模为 `ExternalVideoRef(provider, providerVideoId, canonicalUrl, checkedAt, health)`，版本快照的是引用和编排元数据，而不是第三方内容。v1 只允许 YouTube、Vimeo 的官方嵌入；拒绝任意直链、任意 iframe HTML 和服务端抓取用户 URL。
7. **v1 不上 CDN**。授权下载端点实现 HTTP byte ranges；只有明确公开发布的、hash URL 对应的派生内容可使用长效 `immutable` 缓存。生产期再将公开内容放 CDN，将私有内容放私有 origin 并发短时签名 URL。
8. **不能默认启用仓库中的 `ffmpeg-static@5.3.0`**。该发布包元数据声明 `GPL-3.0-or-later`；FFmpeg 上游说明最终许可取决于所启用组件。必须先完成分发、编解码器和专利审查，再配置 `MEDIA_FFMPEG_PATH`；未配置时，v1 应明确禁用托管音视频转码，而不是静默调用该包。[npm 5.3.0 元数据](https://registry.npmjs.org/ffmpeg-static/5.3.0)；[FFmpeg 上游 LICENSE](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/LICENSE.md)

## 1. 仓库基线与不可越过的边界

以下是本仓库事实，不是外部产品假设：

- 服务端是原生 `node:http` 单体；通用请求体上限为 256 KiB，见 [`server/index.ts`](../../server/index.ts) 和各 JSON route。媒体必须使用不聚合整个 body 的独立流式路由。
- SQLite 使用 `better-sqlite3`；当前没有媒体表、上传路由、对象存储或 multipart 依赖，见 [`package.json`](../../package.json)。
- [`server/media/paths.ts`](../../server/media/paths.ts) 已定义 SHA-256、`data/media/<sha256>.<ext>` 和路径逃逸检查。这是应保留的契约，不应另造第二个 blob 根。
- 现有 `hashMediaBytes(bytes)` 会持有完整字节；它适合小对象测试，不适合大视频。大文件应使用 Node `createHash('sha256')` 的流式更新接口。[Node.js `crypto.createHash`](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options)
- `ffmpeg-static@5.3.0` 已安装但未被源码调用；它是待审查的实现选项，不是已批准的基础设施。
- `Question.visualization` 仍是纯数据 JSON，与未来 `MediaAsset` 分离。本报告不改变该边界。

已有领域决策继续成立：`TeachingDemonstration` 是小型根；草稿、不可变版本和资产各自独立；提交时版本固定引用平台 blob；媒体在多作品间可复用且按引用回收。

## 2. 方案矩阵

| 方案 | v1 复杂度 | 大文件恢复 | 单体适配 | 生产扩展 | 主要代价 | 判断 |
|---|---:|---:|---:|---:|---|---|
| 普通 `multipart/form-data` 全程经过 Node | 低 | 无 | 高 | 低 | 中断重传；代理/进程长连接；未来需换协议 | 只可作极小文件应急入口，不作为主链路 |
| **tus + 本地临时盘 + 本地 CAS** | 中 | **有** | **高** | **中高** | 需上传会话、清理和配额预留 | **v1 推荐** |
| 浏览器直传 S3 multipart + worker + CDN | 高 | 有 | 中 | **高** | 签名、分片状态、CORS、扫描前隔离更复杂 | 生产自建推荐目标 |
| Mux / Cloudflare Stream 托管视频；其余媒体自管 | 中 | 有 | 高 | 高 | 视频供应商锁定、数据区域/价格/回调依赖 | 生产可选，不作为 v1 默认 |

S3 multipart 由“创建、上传 parts、完成”组成，part number 范围是 1 到 10,000；未完成 parts 会持续占用并计费，必须完成或 abort，也可用生命周期规则清理。[AWS S3 multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)；[abort incomplete multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/abort-mpu.html) 这使它非常适合生产直传，但对单机 v1 来说，tus 的本地 FileStore 路径更短。

官方 `tus-node-server` 可以集成进 Node 服务并提供磁盘、S3 等 store，因此 v1 采用 tus 不会把上传协议锁死在本地盘。[tus Node server 第一方仓库](https://github.com/tus/tus-node-server) Cloudflare Stream 的官方直传也要求超过 200 MB 的文件使用 tus，并建议不可靠网络上的小文件也使用 tus，说明该协议同样存在托管生产出口。[Cloudflare Stream resumable uploads](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/)

Mux 和 Cloudflare Stream 都能由后端签发一次性直传地址，让浏览器不经应用服务器上传；Mux 再通过 upload/asset webhook 关联业务对象，Cloudflare 也支持 tus 直传。[Mux direct uploads](https://www.mux.com/docs/guides/upload-files-directly)；[Cloudflare direct creator uploads](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/) 它们是“以后少养转码基础设施”的备选，不应让 v1 的 `MediaAsset` 直接等同于某个供应商 asset ID。

## 3. 推荐的 v1 模型

### 3.1 记录与职责

建议至少包含以下持久化记录；字段名是建议，不要求与最终 ORM 命名一致：

```text
MediaAsset
  id, ownerId, kind(image|audio|model3d|video|subtitle)
  originalBlobHash, status, displayName, createdAt, deletedAt

MediaBlob
  hash, canonicalExtension, mediaType, byteSize
  storageKey, scanStatus, createdAt

MediaDerivative
  assetId, role(display|thumbnail|poster|playback|caption)
  blobHash, sourceBlobHash, recipeName, recipeVersion

UploadSession
  id, ownerId, intendedKind, declaredBytes, receivedBytes
  tempKey, state, quotaReservationBytes, expiresAt

MediaJob
  id, assetId, jobType, state, attempts
  availableAt, leaseOwner, leaseExpiresAt, lastErrorCode

ExternalVideoRef
  id, ownerId, provider, providerVideoId, canonicalUrl
  health, checkedAt, consecutiveFailures, lastFailureCode
```

关键不变量：

- `MediaBlob.hash` 全局唯一；`MediaAsset` 拥有业务身份，但不拥有独占文件。
- 原文件名仅作经过长度/字符清洗的展示元数据，绝不参与磁盘路径。
- 扩展名来自服务端确认的规范 MIME/容器映射，而不是用户文件名。现有 `extensionFromFilename` 只能用于提示或临时兼容，不能成为安全判断。
- 派生物不覆盖原文件；相同 `sourceBlobHash + recipeName + recipeVersion` 应幂等地产生或复用同一结果。
- 发布版本记录具体 `assetId + blobHash/derivativeHash`。资产以后产生新派生物，也不会让历史版本漂移。
- `ExternalVideoRef` 不伪装成 `MediaBlob`；第三方可以删除、设私密或禁止嵌入，平台无法提供内容不可变保证。

### 3.2 BlobStore 接口

```ts
interface BlobStore {
  putQuarantined(uploadId: string, source: Readable): Promise<TempObject>
  openTemp(tempKey: string): Promise<Readable>
  commitByHash(tempKey: string, hash: string, ext: string): Promise<StoredBlob>
  open(hash: string, range?: ByteRange): Promise<Readable>
  stat(hash: string): Promise<BlobStat | null>
  delete(hash: string): Promise<void>
}
```

v1 的 `FsBlobStore` 写 `data/uploads/<random-id>.part`，通过后提交到现有 `data/media/<hash>.<ext>`。生产的 `S3BlobStore` 使用隔离前缀和正式前缀；条件写 `If-None-Match: *` 可防止覆盖已有 key。[AWS S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) 生产直传可使用有时效、受创建者权限约束的 presigned URL，浏览器不需要云凭据。[AWS S3 presigned uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)

S3 自带上传校验不能替代平台内容 hash：multipart 的 SHA-256 是 composite checksum，不是本模型要求的完整字节 SHA-256；AWS 的官方表格明确区分 full-object 和 composite 算法。[AWS S3 object integrity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html) 因此生产期仍需在可信 worker 中计算平台 SHA-256，或者由客户端提供后再由 worker复核。

## 4. 上传协议、配额和完成语义

### 4.1 单一 tus 入口

推荐流程：

1. `POST /api/media/upload-sessions`：鉴权、校验 intended kind/declared size、事务内预留配额，返回 tus upload URL。
2. 浏览器用 `tus-js-client` 上传；断线后用 upload URL 恢复。服务端设置 `Tus-Max-Size`，上传设置 24 小时 `Upload-Expires`。
3. 每个 `PATCH` 同时限制声明长度、实际读取长度、owner、会话状态和剩余配额。若客户端支持 tus checksum 扩展，对每个 chunk 校验；失败 chunk 不推进 offset。该行为由 tus checksum 扩展定义。[tus checksum extension](https://tus.io/protocols/resumable-upload#checksum)
4. 收满后只把会话置为 `quarantined` 并入队，不直接返回 `ready`。
5. worker 流式重算完整 SHA-256，检查类型/恶意内容/资源上限，产生派生物，最后在一个 SQLite 事务里提交 blob、资产、派生物并释放配额预留。
6. 失败、取消和过期都释放预留并清理临时文件；清理器还需扫描“有临时文件但无活动会话”的孤儿。

不推荐同时维护 tus 和 multipart 两套主路径。若产品必须支持无需 JavaScript 的小封面上传，可另设不超过 10 MiB 的 streaming multipart 入口，但它必须复用同一隔离、校验和完成服务。

### 4.2 v1 临时配额

这些数值是**产品尚未给出容量预算时的保守启动配置**，不是行业标准；全部应为环境配置并通过运行数据调整：

| 类型 | 单文件硬上限 | 解码后/时长上限 | v1 派生物 |
|---|---:|---|---|
| JPEG/PNG/WebP | 25 MiB | 40 MP；最长边 16,384 px | 1,600 px 展示图；480 px 缩略图 |
| 音频 | 250 MiB | 120 分钟；最多 2 个声道用于播放版 | 1 个兼容播放版；波形延后 |
| GLB | 200 MiB | 节点、primitive、三角形、纹理尺寸与总解码纹理像素分别设限 | 用户封面；自动 3D 缩略图延后 |
| 视频 | 2 GiB | 120 分钟；最多一个视频流 + 一个主音轨进入播放版 | 1 个 MP4 播放版；1 张 poster |
| WebVTT | 2 MiB | 50,000 cues；UTF-8 | 原样规范化后的 caption blob |

账户层建议先设：每位教师 5 GiB 逻辑原始内容、同时 2 个上传、临时盘预留不超过 3 GiB、同时 1 个视频处理作业。配额按“该 owner 首次引用一个原始 hash”计逻辑字节，派生物另设平台预算；全局物理去重不能让一个租户免费占用另一租户的额度，也不能通过响应差异泄露“某 hash 已存在”。

配额必须在上传前**预留**，而不是完成后才检查。服务端还必须计数实际流入字节，不能只信 `Content-Length` 或 tus metadata。OWASP 的文件上传指南同时要求授权上传者、大小限制、随机文件名、webroot 外存储和防 CSRF。[OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

## 5. 敌对文件检查

### 5.1 通用门禁

对所有托管文件依次执行：

1. **允许列表**：只接受业务需要的扩展/类型；拒绝 SVG、HTML、PDF、压缩包、可执行文件和任意 direct URL。
2. **三方比对**：声明 MIME、文件签名、实际解析器结果必须一致；浏览器提交的 `Content-Type` 只作提示。OWASP 明确指出 `Content-Type` 可伪造，扩展和签名检查都不能单独作为保证。[OWASP 文件类型与签名检查](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html#file-upload-protection)
3. **恶意软件扫描**：在解析/发布前调用独立 `clamd`；扫描器不可用时保持 `quarantined`，不得 fail-open。`clamdscan` 是连接已运行 `clamd` 的客户端，扫描配置属于 daemon。[ClamAV scanning manual](https://docs.clamav.net/manual/Usage/Scanning.html#clamdscan)
4. **真实解析**：图像用 Sharp；音视频用 ffprobe；GLB 用 Khronos Validator，并额外执行平台资源上限。解析失败即拒绝，不能因扩展看似正确而放行。
5. **隔离执行**：FFmpeg、validator 和未来 3D renderer 都作为无 shell 插值的子进程运行，使用参数数组；设 wall-clock、CPU/内存、输出字节和进程数限制。生产时移动到无云凭据、无内网访问、只读输入的 worker 容器。
6. **输出再验证**：派生物也检查类型、大小和 hash；只有所有必需派生物完成后资产才 `ready`。

OWASP 将解析器漏洞、ZIP/XML bomb、磁盘耗尽、覆盖和主动内容列为上传威胁，并建议 webroot 外存储、杀毒/沙箱和保持解析库更新。[OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) 本方案通过“不接受 archive/SVG + 解码资源上限 + 隔离 worker”缩小 v1 攻击面。

### 5.2 类型专属检查与变换

#### 图像

- v1 只接收 JPEG、PNG、WebP；动画 GIF、SVG、TIFF、PDF 和多页输入延后。
- Sharp 使用 `failOn: 'warning'`、`limitInputPixels: 40_000_000`、`limitInputChannels`，绝不设置 `unlimited: true`。Sharp 官方构造器提供像素、通道和安全特性限制，且对不可信输入建议保留默认 `failOn: 'warning'`。[Sharp constructor](https://sharp.pixelplumbing.com/api-constructor)
- 先按 EXIF orientation 旋转，再输出无原始 EXIF/XMP/IPTC 的 WebP/JPEG 展示图和缩略图。Sharp 只有显式调用 `withMetadata()` 才会保留大部分输入元数据，因此派生物不要调用它。[Sharp output metadata](https://sharp.pixelplumbing.com/api-output#withmetadata)
- 原始 blob 保留用于可追溯性，但默认下载名与 HTTP 响应头必须安全；展示页面只渲染经过处理的派生图。

#### 音频与视频

- 先用 `ffprobe` 读取机器可解析的 format/stream 信息，拒绝无法识别、时长异常、流数量超限或声明/实际类型不一致的文件。ffprobe 官方文档说明它能输出容器和各媒体流信息，并在 URL/文件不可打开或不可识别时返回正退出码。[ffprobe documentation](https://ffmpeg.org/ffprobe.html)
- v1 转码意图固定为：一个不放大的、受最大分辨率限制的 MP4 播放版；视频像素格式固定；只映射第一个视频流和选定音轨；写入适合渐进播放的容器布局；另抽取一张 poster。具体 H.264/AAC 编码器和参数只有在许可证/专利审查批准后才能落地。
- FFmpeg 输入禁止网络协议，子进程 stdin 关闭；限制探测大小、分析时长、线程、总运行时间和最大输出。任何超时、信号退出、超预算输出都进入可重试/不可重试的明确错误码。
- 没有已批准 `MEDIA_FFMPEG_PATH` 时：图像/GLB/外链仍可用；托管音视频上传在创建 session 前返回 capability-disabled，不能接受原件后永久卡在 processing。
- v1 不生成 HLS。生产在并发或网络条件证明需要后，才生成多码率 HLS master/media playlists；HLS 规范由 master playlist 选择 variant stream，媒体由 playlist 和 segments 组成。[RFC 8216](https://www.rfc-editor.org/rfc/rfc8216.html)

#### 3D 模型

- v1 只接受 `.glb`，不接受 `.gltf + 外部文件/ZIP`。解析 JSON chunk 后拒绝所有外部 URI，只允许 GLB 内嵌资源；再运行 Khronos Validator 的资源验证。
- Khronos 官方 validator 可验证 `.gltf`/`.glb`，输出 JSON report，并在出现 error 时返回非零退出码。[Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator)
- Validator 证明结构符合规范，不代表资源消耗可接受；平台仍需限制节点、primitive、accessor、三角形、动画、纹理数量/尺寸和解码后总像素。这些阈值必须在加载 Three.js 前检查。
- v1 要求作者选择或上传封面图；不在单体服务器中自动启动 WebGL renderer。生产期若需要自动缩略图，再建设隔离、确定版本的 renderer，并把 renderer 版本写入 derivative recipe。

#### 字幕

- v1 只接受 UTF-8 WebVTT，服务端使用真正的 WebVTT parser 校验 signature、时间顺序、cue 数和总时长；不把 cue 文本当 HTML 注入页面。WebVTT 规范要求以 UTF-8 解码并在缺失 WebVTT signature 时中止解析。[W3C WebVTT](https://www.w3.org/TR/webvtt1/#file-parsing)
- 字幕是独立不可变资产并由版本明确引用。外链视频字幕由提供商播放器控制；v1 不抓取、不复制。
- 自动语音识别、翻译和人工校订工作流延后。若以后使用 Mux 等托管方案，其官方服务可以生成 captions/transcripts，但这会引入供应商和数据处理决策。[Mux captions](https://www.mux.com/docs/guides/add-autogenerated-captions-and-use-transcripts)

## 6. 播放、Range 与 CDN

### 6.1 v1

`GET /api/media/blobs/:hash` 先按作品/资产可见性授权，再流式返回。必须实现：

- 单一 byte range 的 `206 Partial Content`、`Content-Range`、`Accept-Ranges: bytes` 和无效范围的 `416`；HTTP 语义规范用这些字段表达部分表示。[RFC 9110 §14 Range Requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests)
- 正确 `Content-Type`、`Content-Length`、`ETag`（可使用引号包裹的内容 hash）和 `X-Content-Type-Options: nosniff`。
- 私有/草稿内容：`Cache-Control: private, no-store` 或短时私有缓存；公开发布且 URL 含 hash 的派生物：`Cache-Control: public, max-age=31536000, immutable`。RFC 8246 给出的标准示例正是该 directive 组合；只有 URL 内容永不变化时才可用。[RFC 8246](https://www.rfc-editor.org/rfc/rfc8246.html)
- 原始上传默认不公开。页面使用受控派生物；下载原件是单独授权动作。

v1 不部署 CDN，因为单机、低并发时它只增加私有缓存失配和运维面。先让 URL、缓存头、Range 和可见性正确，后续迁移不改客户端资产身份。

### 6.2 生产

生产形态：浏览器直传隔离 bucket/prefix -> 事件/作业队列 -> 扫描/转码 worker -> 正式不可变 prefix -> CDN。公开发布物可长缓存；私有作品必须保持 origin 私有，由应用签发短时 URL/cookie。CloudFront 官方流程要求应用先判断访问资格，再生成签名 URL；Cloudflare Stream 和 Mux 也分别支持签名 token/playback policy。[CloudFront signed URLs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-urls.html)；[Cloudflare Stream secure playback](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/)；[Mux playback policies](https://www.mux.com/docs/guides/play-your-videos)

选择对象存储/CDN 供应商时，必须再决策数据驻留、出境、origin access、egress、生命周期和删除时限。本票只固定接口和安全语义，不固定供应商。

## 7. 外链视频

### 7.1 v1 白名单与规范化

初始只实现两个 adapter：

| Provider | 接受的用户输入 | 持久化 | 播放 |
|---|---|---|---|
| YouTube | 官方 `youtube.com/watch?v=...`、`youtu.be/...` 的公开单视频 URL | `provider=youtube` + 规范化 video ID | 应用自己构造官方 `/embed/VIDEO_ID` iframe |
| Vimeo | 官方 `vimeo.com/<numeric-id>` 的公开视频 URL | `provider=vimeo` + numeric ID | 官方 `player.vimeo.com/video/ID` iframe / Player SDK |

YouTube 官方参数文档规定 iframe 的视频由 `src` 中的 video ID 选择；Vimeo 第一方 Player SDK 支持按 ID 加载并以 `PrivacyError` 表示隐私限制。[YouTube player parameters](https://developers.google.cn/youtube/player_parameters?hl=en)；[Vimeo Player SDK](https://github.com/vimeo/player.js)

必须拒绝：任意 `<iframe>` HTML、任意 `http(s)` 视频直链、IP 地址、用户名密码 URL、非白名单端口、短链继续跳转到未知域、播放列表/频道、需密码/登录的视频。服务端不请求用户提交的原始 URL；它先纯字符串解析成 provider ID，再调用写死 host 的官方 API/oEmbed 端点。OWASP SSRF 指南对可枚举目标推荐 allowlist，并警告重定向和 DNS 解析带来的绕过面。[OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

不渲染 oEmbed 返回的 `html`。oEmbed 的 video response 本来就可以包含一段嵌入 HTML；平台只消费标题、缩略图和 provider 元数据，并用自己的 iframe template。[oEmbed specification](https://oembed.com/)

iframe 使用固定 `allow`/`sandbox`/`referrerpolicy` 策略；CSP 的 `frame-src` 只列官方播放域。CSP 规范定义 `frame-src` 用于限制 child navigable 可加载的 URL。[W3C CSP3 `frame-src`](https://www.w3.org/TR/CSP3/#directive-frame-src)

### 7.2 隐私边界

- 默认显示本地保存的封面和 provider 标识；用户点击“加载外部视频”后才创建 iframe。这样在点击前不会主动连接第三方播放器。
- 创建外链时明确提示：播放会向第三方发送网络请求，平台不控制其 cookies、可用性、字幕或内容变更。
- 不把平台访问 token、用户标识或草稿信息放进 iframe URL；不使用 provider 返回的任意脚本。
- 外链不下载、不转存、不进平台 CDN；若需要可审计、可长期播放的作品，作者应改用托管上传并确保拥有相应权利。

### 7.3 失效检测

保存时做一次同步验证，发布中的外链每 24 小时后台复检，草稿每 7 天复检；具体周期应可配置。检查器使用 provider adapter，不做通用 HEAD：

- 通用 oEmbed：`404` 表示 provider 对 URL 无可用表示，`401` 表示 private resource；这些状态由 oEmbed 规范定义。[oEmbed errors](https://oembed.com/#section2.3.5)
- YouTube：可选 API key 存在时调用 `videos.list`；播放期监听 IFrame API `onError`。官方错误码 `100` 表示找不到/已删/私密，`101`/`150` 表示不允许嵌入。[YouTube IFrame API](https://developers.google.cn/youtube/iframe_api_reference?hl=en)
- Vimeo：oEmbed 预检，播放期捕获 Player SDK 的 `PrivacyError`/加载失败。[Vimeo Player SDK](https://github.com/vimeo/player.js)

状态建议为 `unknown | healthy | degraded | unavailable | private | embed_forbidden`。第一次网络/5xx/429 只记 `degraded` 并指数退避；三个独立检查窗口仍失败才置 `unavailable`。**不得自动改写或删除历史版本**，只在播放位显示明确故障和原始 provider 链接，并通知资产 owner。一次成功检查清零连续失败计数。

YouTube、Vimeo 之外的 provider（包括面向中国大陆的站点）只有在拿到稳定的官方 embed/API 文档、使用条款、隐私参数和可用性检测语义后才能新增 adapter；不得用正则拼一个 iframe 当作“支持”。

## 8. 作业状态、幂等与故障处理

| 故障 | v1 行为 | 恢复/生产演进 |
|---|---|---|
| 客户端断线 | tus 保留 offset；未过期可续传 | 对象存储 multipart/tus 直传 |
| 上传声明小、实际超限 | 流读取达到上限立即终止并释放预留 | 网关和对象存储策略再加一层 |
| 临时盘满 | session 失败、拒绝新预留、告警 | 隔离 bucket + 容量告警 |
| 同 hash 并发完成 | 按 hash 加锁；仅一个 commit，其他复用 blob | S3 conditional write |
| ClamAV 不可用 | 保持 quarantine，重试；不发布 | 独立扫描池/托管扫描服务 |
| parser/FFmpeg crash 或超时 | 终止进程、记录稳定错误码、有限重试 | 资源隔离 worker / dead-letter queue |
| worker/单体重启 | SQLite lease 到期后重新认领幂等 job | 外部队列 + 独立 worker |
| 派生物 recipe 变化 | 生成新 derivative，不覆盖旧 hash | 后台按需迁移；历史版本仍指旧结果 |
| CDN 泄露私有 URL | v1 不用公共 CDN；严格区分缓存头 | 私有 origin + 短时签名 URL/cookie |
| provider 429/5xx | degraded + backoff，不误判删除 | provider-specific rate budget |
| provider 内容被删/设私密 | 保留引用，播放器故障态，通知 owner | 可要求发布前重新验证 |

作业认领应是 SQLite 短事务：选择到期/可运行 job，写 `leaseOwner/leaseExpiresAt` 后提交，再在事务外运行重任务。完成写入必须验证 lease 且幂等。不要在持有 SQLite 写事务时扫描或转码。

删除采用已有软删语义：资产删除只减少引用；blob 只有在作品版本、草稿、派生物和活动作业均无引用，且超过恢复保留期后才物理删除。临时上传则采用更短 TTL，二者不能共用回收规则。

## 9. 分阶段演进

### Phase 1：单部署 v1

- 新增 `MediaAsset/Blob/Derivative/UploadSession/MediaJob/ExternalVideoRef`。
- 接入 tus Node server + 本地 temp store；服务端流式 SHA-256。
- 图像处理、GLB validator、ClamAV 门禁；许可通过后启用音视频 probe/transcode。
- 单 worker，视频并发 1；授权 Range endpoint；无 CDN、无 HLS。
- YouTube/Vimeo adapter、点击后加载、持久化健康检查。

### Phase 2：对象存储但仍单应用

- `FsBlobStore -> S3BlobStore`，CAS key 与数据库 hash 不变。
- 浏览器经短时签名 URL/tus 直传 quarantine prefix；应用只发 session、收完成通知、排 job。
- 配置 abort incomplete multipart 生命周期和临时对象 TTL。
- 先保持同一 SQLite job 表，验证容量/失败语义后再拆队列。

### Phase 3：独立处理与 CDN

- SQLite job 迁移到可见性超时/死信能力的队列；扫描、图像、音视频、3D 分 worker 池。
- 公开派生物接 CDN；私有播放用签名 URL/cookie。
- 有数据证明需要时生成 HLS ABR、预览 sprite、波形；recipe/version 保证可重建。
- 若自营转码成本高，将 `VideoProcessor` 实现替换为 Mux、Cloudflare Stream 或 MediaConvert；业务仍持有自己的 asset/blob/external-ref 身份。AWS 将 MediaConvert 定义为文件型视频转码服务，可作为对象存储工作流的一种托管实现。[AWS Elemental MediaConvert](https://docs.aws.amazon.com/mediaconvert/latest/ug/what-is.html)

## 10. 明确延后的决策

以下问题不应在本票中被默认答案掩盖：

1. `ffmpeg-static` 分发、FFmpeg build flags、H.264/AAC 等编解码器和地域专利许可审查。
2. ClamAV 是否随单部署交付、病毒库更新 SLA、扫描失败时的运营处置。
3. 真实账户/组织配额、派生物计费、跨租户物理去重和删除保留期。
4. 对象存储/CDN/转码供应商、数据驻留、出境与教育数据合规。
5. HLS/CMAF/DASH、码率阶梯、HDR、旋转、多音轨和直播支持。
6. 自动字幕、翻译、敏感内容审核和无障碍质量门槛。
7. GLB 的精确节点/三角形/纹理阈值、Draco/KTX2 支持和服务端缩略图 renderer。
8. YouTube/Vimeo 之外 provider 的正式 adapter，尤其中国大陆可用的官方嵌入方案。
9. 外链在审核/发布前必须达到何种健康等级，以及失效通知/下架 SLA。
10. 公开发布后原始文件是否允许下载；目前建议默认只公开派生播放物。

## 11. 验收清单

- [ ] 任何媒体字节都不经过 256 KiB JSON parser，也不一次性读入 Node heap。
- [ ] 中断上传可恢复；超限、取消、过期会话释放配额并清理 temp。
- [ ] 服务端完整 SHA-256 是 blob 身份；文件名/MIME/扩展都不能改变既有 hash 内容。
- [ ] quarantine 未通过时无公开 URL；scanner 不可用时 fail-closed。
- [ ] 每种解析器都有输入、解码资源、时间和输出上限。
- [ ] 派生物记录 source hash 与 recipe version；失败重试不会重复创建资产。
- [ ] 发布候选只引用 `ready` 资产和具体 blob/derivative hash。
- [ ] 视频 Range 播放正确；私有/公开缓存策略不会混用。
- [ ] 任意 URL、任意 iframe、服务端跟随用户重定向均被拒绝。
- [ ] 外链 provider 错误不会删除或改写历史版本。
- [ ] 未完成许可证审查时，托管音视频转码明确禁用。
- [ ] 从本地盘迁移 S3/CDN/worker 不改变领域身份或版本快照。

## Sources

以下全部于 **2026-07-31** 访问：

- tus, *Resumable Upload Protocol 1.0.x*: https://tus.io/protocols/resumable-upload
- tus, *tus-node-server* first-party repository: https://github.com/tus/tus-node-server
- Node.js, `crypto.createHash`: https://nodejs.org/api/crypto.html#cryptocreatemd5sha1sha256sha512hashalgorithm-options
- AWS S3, multipart upload: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html
- AWS S3, abort incomplete multipart: https://docs.aws.amazon.com/AmazonS3/latest/userguide/abort-mpu.html
- AWS S3, object integrity/checksums: https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html
- AWS S3, presigned upload: https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html
- AWS S3, conditional writes: https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html
- OWASP, *File Upload Cheat Sheet*: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- OWASP, *SSRF Prevention Cheat Sheet*: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- ClamAV, scanning manual: https://docs.clamav.net/manual/Usage/Scanning.html
- Sharp, constructor and limits: https://sharp.pixelplumbing.com/api-constructor
- Sharp, output metadata: https://sharp.pixelplumbing.com/api-output
- FFmpeg, ffprobe: https://ffmpeg.org/ffprobe.html
- FFmpeg, upstream license: https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/LICENSE.md
- npm registry, `ffmpeg-static@5.3.0`: https://registry.npmjs.org/ffmpeg-static/5.3.0
- Khronos, glTF Validator: https://github.com/KhronosGroup/glTF-Validator
- IETF, RFC 9110 Range Requests: https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests
- IETF, RFC 8246 Immutable Responses: https://www.rfc-editor.org/rfc/rfc8246.html
- IETF, RFC 8216 HTTP Live Streaming: https://www.rfc-editor.org/rfc/rfc8216.html
- W3C, WebVTT: https://www.w3.org/TR/webvtt1/
- W3C, CSP Level 3 `frame-src`: https://www.w3.org/TR/CSP3/#directive-frame-src
- oEmbed specification: https://oembed.com/
- Google, YouTube IFrame API: https://developers.google.cn/youtube/iframe_api_reference?hl=en
- Google, YouTube player parameters: https://developers.google.cn/youtube/player_parameters?hl=en
- Google, YouTube Data API `videos.list`: https://developers.google.cn/youtube/v3/docs/videos/list?hl=en
- Vimeo, Player SDK first-party repository: https://github.com/vimeo/player.js
- AWS CloudFront, signed URLs: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-urls.html
- Mux, direct uploads: https://www.mux.com/docs/guides/upload-files-directly
- Mux, playback: https://www.mux.com/docs/guides/play-your-videos
- Mux, captions/transcripts: https://www.mux.com/docs/guides/add-autogenerated-captions-and-use-transcripts
- Cloudflare Stream, direct creator uploads: https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/
- Cloudflare Stream, resumable tus uploads: https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/
- Cloudflare Stream, secure playback: https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
- AWS Elemental MediaConvert: https://docs.aws.amazon.com/mediaconvert/latest/ug/what-is.html
