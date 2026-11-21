# AI Nutrition CDSS Platform

Clinical Decision Support System (CDSS) for chronic-disease dietary management (CKD, Diabetes Type 2, Hypertension, Gout, Kidney Stones, Liver/GERD) compliant with **FDA Non-Device CDS (21 U.S.C. 360aaa)** and **Human-in-the-Loop (HITL)** clinical review.

## Architecture & Technical Pillars

```
UI (React 18 / Tailwind v4)
  ├── Stage 1 Input Guardrails (PII Redaction, Prompt-Injection Blocker, 115 Emergency & Med-Dose Guard)
  ├── Stateful Workflow Agents
  │     ├── ReAct Clinical Consult Agent (OpenAI native tool_calls / deterministic fallback)
  │     └── Self-Correcting Meal Plan DAG (Ingest -> Hybrid RAG -> Model -> Self-Repair Loop -> HITL)
  ├── Hybrid RAG Engine (Chunking + BM25 + Sparse Char-Trigram Cosine Similarity (không dùng embedding API) + Reciprocal Rank Fusion + Grounding Check)
  ├── Real MCP Layer (JSON-RPC 2.0)
  │     └── HTTP JSON-RPC 2.0 (/api/mcp) & In-Process Browser Fallback: 6 Tools, 3 Resources, 2 Prompts
  ├── Backend AI Gateway (server/index.ts) + Multi-Model Router (Tiers, Retry, Circuit Breaker, USD Cost)
  └── OpenTelemetry-Style Observability (Hierarchical TraceSpans, P50/P95, OTLP JSON Export)
```

### Key Implementation Decisions
1. **Zero Client Secret Exposure**: Production API keys stay in server `.env` via `server/index.ts` (`/api/health`, `/api/ai/test`, `/api/ai/chat`, `/api/ai/stream`, `/api/ai/embeddings`, `/api/mcp`). Pure static Vite deployments gracefully fall back to client-BYOK or deterministic local clinical safety engines.
2. **Approved-Only Hybrid RAG**: Only `status === 'Đã duyệt'` clinical documents are chunked and indexed using BM25 + sparse char-trigram cosine similarity + RRF fusion, followed by automated citation grounding verification.
3. **3-Stage Guardrails**: PII (`CCCD`, Vietnamese phone numbers, email, `BHYT`) is masked prior to transport; prompt injections and emergency symptoms are stopped before LLM invocation; and outputs undergo Zod schema + Atwater calorie math + deterministic allergy/DDI checks.
4. **HL7 FHIR R4 Interoperability**: Active clinical meal plans export directly to standard `FHIRNutritionOrder` resources (`src/models/fhir/nutritionOrder.ts`) via the `export_fhir_nutrition_order` MCP tool.
5. **AI Control Center (`/ai-ops`)**: Dedicated engineering console for Expert/Admin roles featuring an OpenTelemetry Span Waterfall, Workflow DAG & Checkpoint Resume, live JSON-RPC MCP Inspector, Red-Team Lab, and 31-case AI Benchmark Runner (số case lấy từ `EVAL_CASE_COUNT`).

## Quick Start & Commands

```powershell
# 1. Install dependencies
npm.cmd ci

# 2. Run Full-Stack (Backend AI Gateway :8787 + Vite Frontend :5173)
copy .env.example .env   # Điền AI_API_KEY (Google AI Studio). KHÔNG đặt key trong mã frontend
npm.cmd run dev:full

# 3. Run Frontend Only (Static / Hybrid Mode)
npm.cmd run dev

# 4. Run Full Test Suite (Unit + Integration + Regression + A+ Architecture)
npm.cmd test

# 5. Run 31-Case AI Evaluation Quality Gate (outputs eval-report.json & EVAL_REPORT.md)
npm.cmd run eval

# 6. Typecheck & Production Build
npm.cmd run build
```

## Demo Accounts
- **Patient**: `patient@demo.vn` / `Demo123!`
- **Clinical Expert (HITL + AI Ops)**: `expert@demo.vn` / `Demo123!`
- **System Admin (Audit + AI Ops)**: `admin@demo.vn` / `Demo123!`


## Cấu hình AI (một nguồn duy nhất)
- Mặc định (provider, model, timeout, model dự phòng) nằm ở `src/services/aiConfig.ts`; frontend, `modelRouter`, `aiService` và `server/index.ts` đều import từ đây.
- Mặc định: Google Gemini qua endpoint OpenAI-compatible, model `gemini-flash-latest`; nếu model trả 404 sẽ tự thử `gemini-2.5-flash` rồi `gemini-flash-latest`.
- Kiểm tra kết nối thật: chạy `npm run server` rồi mở `http://127.0.0.1:8787/api/ai/test` (trả về model đang dùng, độ trễ hoặc lỗi gốc của nhà cung cấp).

## Luồng bệnh án -> toàn hệ thống
Nút **Nạp bệnh án** (hoặc kéo-thả tệp / Ctrl+V ảnh / dán văn bản) có mặt ở mọi trang của bệnh nhân. AI bóc tách -> bản nháp -> người dùng xác nhận -> `confirmMedicalRecord()` đồng bộ vào Hồ sơ, Sơ đồ cơ quan, Nhật ký ăn uống (cảnh báo), Tư vấn AI và Thực đơn (Hybrid RAG trên tài liệu đã duyệt + ngưỡng dinh dưỡng giao cắt đa bệnh lý).
