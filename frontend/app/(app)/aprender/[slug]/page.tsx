"use client";

/**
 * /aprender/[slug] — Round 152v · Módulo individual + Quiz.
 *
 * Flujo: lee content_md → quiz interactivo → submit → resultado con feedback
 * por pregunta + badge si aprueba (≥70%).
 */
import { use, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Trophy,
  RotateCcw,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface ModuleDetail {
  module_id: number;
  slug: string;
  title: string;
  description: string | null;
  difficulty: string;
  duration_min: number;
  content_md: string | null;
  quiz: { q: string; options: string[] }[] | null;
  my_score: number | null;
  completed: boolean;
}

interface QuizResult {
  score: number;
  correct: number;
  total: number;
  passed: boolean;
  completed: boolean;
  feedback: {
    q: string;
    your_answer: number;
    your_text: string | null;
    correct_answer: number;
    correct_text: string;
    was_correct: boolean;
  }[];
}

export default function ModuloPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { session } = useSession();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);

  const { data: mod, isLoading } = useQuery<ModuleDetail>({
    queryKey: ["training", "module", slug],
    queryFn: () => apiClient.get<ModuleDetail>(`/training/modules/${slug}`, session),
    enabled: !!session,
  });

  const submitMut = useMutation({
    mutationFn: (payload: { slug: string; answers: number[] }) =>
      apiClient.post<QuizResult>("/training/complete", payload, session),
    onSuccess: (r) => setResult(r),
  });

  const onSubmit = () => {
    if (!mod?.quiz) return;
    const arr = mod.quiz.map((_, i) => answers[i] ?? -1);
    submitMut.mutate({ slug, answers: arr });
  };

  const onReset = () => {
    setAnswers({});
    setResult(null);
  };

  // Render markdown simple (las secciones del PDF son markdown básico)
  const renderMd = (md: string) => {
    const lines = md.split("\n");
    return lines.map((line, i) => {
      if (line.startsWith("### ")) return <h3 key={i} className="mt-5 mb-2 text-base font-semibold text-ink-900">{line.slice(4)}</h3>;
      if (line.startsWith("## ")) return <h2 key={i} className="mt-5 mb-2 text-lg font-semibold text-ink-900">{line.slice(3)}</h2>;
      if (line.startsWith("- ")) return <li key={i} className="ml-5 list-disc text-sm text-ink-700">{line.slice(2)}</li>;
      if (/^\d+\. /.test(line)) return <li key={i} className="ml-5 list-decimal text-sm text-ink-700">{line.replace(/^\d+\. /, "")}</li>;
      if (line.trim() === "") return <div key={i} className="h-2" />;
      return <p key={i} className="text-sm text-ink-700">{line}</p>;
    });
  };

  if (isLoading || !mod) {
    return <p className="py-12 text-center text-sm text-ink-400">Cargando módulo…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10">
      {/* Back */}
      <Link
        href={"/aprender" as Route}
        className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-cehta-green"
      >
        <ArrowLeft className="size-4" />
        Volver al Centro de Aprendizaje
      </Link>

      {/* Header del módulo */}
      <header className="mt-6">
        <span className="inline-block rounded-full bg-cehta-green/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cehta-green">
          {mod.difficulty} · {mod.duration_min} min
        </span>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">
          {mod.title}
        </h1>
        {mod.description && (
          <p className="mt-2 text-sm text-ink-600">{mod.description}</p>
        )}
      </header>

      {/* Contenido */}
      {mod.content_md && (
        <section className="mt-8 rounded-2xl border border-hairline bg-white p-6 shadow-card">
          <div className="prose prose-sm max-w-none">
            {renderMd(mod.content_md)}
          </div>
        </section>
      )}

      {/* Quiz */}
      {mod.quiz && mod.quiz.length > 0 && !result && (
        <section className="mt-8 rounded-2xl border border-hairline bg-white p-6 shadow-card">
          <h2 className="text-xl font-semibold text-ink-900">Quiz</h2>
          <p className="mt-1 text-xs text-ink-500">
            Aprobás con 70% o más. Tu mejor score se guarda.
          </p>
          <div className="mt-6 space-y-6">
            {mod.quiz.map((q, qIdx) => (
              <div key={qIdx}>
                <p className="text-sm font-semibold text-ink-900">
                  {qIdx + 1}. {q.q}
                </p>
                <div className="mt-2 space-y-1.5">
                  {q.options.map((opt, oIdx) => (
                    <label
                      key={oIdx}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm transition-colors ${
                        answers[qIdx] === oIdx
                          ? "border-cehta-green bg-cehta-green/5"
                          : "border-hairline hover:bg-ink-50/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`q-${qIdx}`}
                        checked={answers[qIdx] === oIdx}
                        onChange={() => setAnswers({ ...answers, [qIdx]: oIdx })}
                        className="size-4 accent-cehta-green"
                      />
                      <span className="text-ink-800">{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={
              submitMut.isPending ||
              Object.keys(answers).length !== mod.quiz.length
            }
            className="mt-6 w-full rounded-xl bg-cehta-green px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cehta-green-700 disabled:cursor-not-allowed disabled:bg-ink-300"
          >
            {submitMut.isPending ? "Calificando…" : "Enviar respuestas"}
          </button>
        </section>
      )}

      {/* Resultado */}
      {result && (
        <section className="mt-8 rounded-2xl border border-hairline bg-white p-6 shadow-card">
          <div className="flex items-center justify-between gap-4 border-b border-hairline pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                {result.passed ? "¡Aprobado!" : "No aprobado"}
              </p>
              <p className="mt-1 text-3xl font-bold text-ink-900">
                {result.score}%{" "}
                <span className="text-base font-normal text-ink-500">
                  ({result.correct}/{result.total})
                </span>
              </p>
            </div>
            <div>
              {result.passed ? (
                <Trophy className="size-12 text-amber-500" />
              ) : (
                <RotateCcw className="size-12 text-ink-300" />
              )}
            </div>
          </div>

          {result.passed && (
            <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              🎉 Módulo completado. Tu progreso quedó guardado en{" "}
              <Link href={"/aprender" as Route} className="font-semibold underline">
                Centro de Aprendizaje
              </Link>
              .
            </div>
          )}

          {!result.passed && (
            <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Necesitas 70% para aprobar. Revisa las respuestas correctas
              abajo y reintenta.
            </div>
          )}

          <h3 className="mt-6 mb-3 text-sm font-semibold text-ink-900">
            Revisión:
          </h3>
          <ol className="space-y-3">
            {result.feedback.map((f, i) => (
              <li
                key={i}
                className={`rounded-xl border p-4 ${
                  f.was_correct
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-red-200 bg-red-50/40"
                }`}
              >
                <div className="flex items-start gap-2">
                  {f.was_correct ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle className="mt-0.5 size-5 shrink-0 text-red-600" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-ink-900">{f.q}</p>
                    <p className="mt-1.5 text-xs text-ink-600">
                      Tu respuesta: <strong>{f.your_text ?? "(sin responder)"}</strong>
                    </p>
                    {!f.was_correct && (
                      <p className="mt-0.5 text-xs text-emerald-700">
                        Correcta: <strong>{f.correct_text}</strong>
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <button
            type="button"
            onClick={onReset}
            className="mt-6 w-full rounded-xl border border-hairline px-4 py-3 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            {result.passed ? "Hacer de nuevo" : "Reintentar"}
          </button>
        </section>
      )}
    </div>
  );
}
