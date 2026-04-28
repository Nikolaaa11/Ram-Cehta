"""ai_conversations + ai_messages + ai_documents (pgvector)

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-26

V3 fase 3 — AI Asistente por empresa. Habilita un chatbot empresa-scoped con
RAG sobre documentos custodiados en Dropbox (`08-AI Knowledge Base/{codigo}/`).

Decisiones:
- `pgvector` extension para embeddings cosine-similarity. Index `ivfflat` con
  `lists=100` — bueno para datasets <1M chunks (sweet spot para Cehta hoy).
- Embedding dim = **1536** (`text-embedding-3-small` de OpenAI). Cost-efficient
  ($0.02/M tokens) y suficiente para QA empresarial.
- Cada conversación pertenece a un único `(user_id, empresa_codigo)` — el
  backend filtra por `user_id == me.sub` para que cada usuario sólo vea SUS
  charlas. Empresa-scope es soft (todos los roles pueden chatear con cualquier
  empresa en V3, según sección 1.6 de V3_VISION).
- `citations` JSONB en mensajes guarda la lista de chunk_ids referenciados por
  el assistant para mostrarlos como badges clickables en el frontend.
- RLS: lectura abierta a `authenticated` (el backend filtra) y escritura sólo
  via `service_role` (mismo patrón que `trabajadores`).
"""
from __future__ import annotations

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- pgvector extension (Supabase la trae preinstalada pero no habilitada).
        CREATE EXTENSION IF NOT EXISTS vector;

        -- Conversaciones (1 user × 1 empresa × N conversaciones).
        CREATE TABLE IF NOT EXISTS core.ai_conversations (
            conversation_id   BIGSERIAL PRIMARY KEY,
            user_id           UUID NOT NULL,
            empresa_codigo    TEXT NOT NULL REFERENCES core.empresas(codigo),
            title             TEXT,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_ai_conv_user_empresa
            ON core.ai_conversations(user_id, empresa_codigo, updated_at DESC);

        -- Mensajes (user / assistant / system).
        CREATE TABLE IF NOT EXISTS core.ai_messages (
            message_id        BIGSERIAL PRIMARY KEY,
            conversation_id   BIGINT NOT NULL
                REFERENCES core.ai_conversations(conversation_id) ON DELETE CASCADE,
            role              TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
            content           TEXT NOT NULL,
            citations         JSONB,
            tokens_used       INT,
            model             TEXT,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_ai_msg_conv
            ON core.ai_messages(conversation_id, created_at);

        -- Documentos indexados (chunks con embeddings).
        CREATE TABLE IF NOT EXISTS core.ai_documents (
            chunk_id          BIGSERIAL PRIMARY KEY,
            empresa_codigo    TEXT NOT NULL REFERENCES core.empresas(codigo),
            source_type       TEXT NOT NULL,
            source_path       TEXT,
            source_id         TEXT,
            chunk_index       INT NOT NULL,
            content           TEXT NOT NULL,
            embedding         vector(1536),
            metadata          JSONB,
            indexed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_ai_docs_empresa
            ON core.ai_documents(empresa_codigo);

        -- IVFFlat con cosine — adecuado para datasets <1M chunks. Para escalar
        -- a >1M considerar HNSW (pgvector >=0.5).
        CREATE INDEX IF NOT EXISTS idx_ai_docs_embedding
            ON core.ai_documents
            USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

        -- RLS
        ALTER TABLE core.ai_conversations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE core.ai_messages ENABLE ROW LEVEL SECURITY;
        ALTER TABLE core.ai_documents ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS ai_conv_read ON core.ai_conversations;
        CREATE POLICY ai_conv_read ON core.ai_conversations
            FOR SELECT TO authenticated USING (TRUE);

        DROP POLICY IF EXISTS ai_msg_read ON core.ai_messages;
        CREATE POLICY ai_msg_read ON core.ai_messages
            FOR SELECT TO authenticated USING (TRUE);

        DROP POLICY IF EXISTS ai_docs_read ON core.ai_documents;
        CREATE POLICY ai_docs_read ON core.ai_documents
            FOR SELECT TO authenticated USING (TRUE);

        -- Triggers updated_at
        DROP TRIGGER IF EXISTS trg_touch_ai_conversations ON core.ai_conversations;
        CREATE TRIGGER trg_touch_ai_conversations
            BEFORE UPDATE ON core.ai_conversations
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS core.ai_messages CASCADE;
        DROP TABLE IF EXISTS core.ai_conversations CASCADE;
        DROP TABLE IF EXISTS core.ai_documents CASCADE;
        -- No droppeamos la extension vector — puede estar en uso por otros schemas.
        """
    )
