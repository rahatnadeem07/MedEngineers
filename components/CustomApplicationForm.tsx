"use client";

import { useState, useEffect } from "react";
import { useSession, signIn } from "next-auth/react";

// Type definitions for form data
interface FormQuestion {
    id: string;
    type: string;
    label: string;
    required: boolean;
    options?: string[];
    min?: number;
    max?: number;
    minLabel?: string;
    maxLabel?: string;
    rows?: string[];
    columns?: string[];
    placeholder?: string;
}

interface FormData {
    title: string;
    description: string;
    questions: FormQuestion[];
}

type FormResponses = Record<string, unknown>;

interface CustomApplicationFormProps {
    onSubmitSuccess?: () => void;
}

export function CustomApplicationForm({ onSubmitSuccess }: CustomApplicationFormProps) {
    const { data: session, status } = useSession();
    const [formData, setFormData] = useState<FormData | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [responses, setResponses] = useState<FormResponses>({});

    // Fetch form data from API
    useEffect(() => {
        async function fetchForm() {
            try {
                const res = await fetch("/api/forms");
                if (!res.ok) {
                    throw new Error("Failed to fetch form");
                }
                const data = await res.json();
                setFormData(data);
                setError(null);
            } catch (err) {
                console.error("Error fetching form:", err);
                setError("Failed to load form. Please check your connection and refresh.");
            } finally {
                setLoading(false);
            }
        }
        fetchForm();
    }, []);

    const updateResponse = (questionId: string, value: unknown) => {
        setResponses((prev) => ({ ...prev, [questionId]: value }));
    };

    const handleCheckboxChange = (questionId: string, option: string, checked: boolean) => {
        const current = (responses[questionId] as string[]) || [];
        if (checked) {
            updateResponse(questionId, [...current, option]);
        } else {
            updateResponse(questionId, current.filter((o) => o !== option));
        }
    };

    const handleGridChange = (
        questionId: string,
        row: string,
        column: string,
        isCheckbox: boolean
    ) => {
        const current = (responses[questionId] as Record<string, string | string[]>) || {};
        if (isCheckbox) {
            const rowValues = (current[row] as string[]) || [];
            if (rowValues.includes(column)) {
                updateResponse(questionId, {
                    ...current,
                    [row]: rowValues.filter((c) => c !== column),
                });
            } else {
                updateResponse(questionId, {
                    ...current,
                    [row]: [...rowValues, column],
                });
            }
        } else {
            updateResponse(questionId, { ...current, [row]: column });
        }
    };

    const handleSubmit = async () => {
        // If not signed in, trigger OAuth
        if (!session) {
            // Store responses in sessionStorage before redirecting to OAuth
            sessionStorage.setItem("pendingFormResponses", JSON.stringify(responses));
            signIn("google");
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const res = await fetch("/api/forms/submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ responses }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to submit");
            }

            setSuccess(true);
            onSubmitSuccess?.();
        } catch (err) {
            console.error("Submit error:", err);
            setError(err instanceof Error ? err.message : "Failed to submit form");
        } finally {
            setSubmitting(false);
        }
    };

    // Restore responses after OAuth redirect
    useEffect(() => {
        if (session && status === "authenticated") {
            const pending = sessionStorage.getItem("pendingFormResponses");
            if (pending) {
                setResponses(JSON.parse(pending));
                sessionStorage.removeItem("pendingFormResponses");
            }
        }
    }, [session, status]);

    const renderQuestion = (question: FormQuestion) => {
        switch (question.type) {
            case "short_answer":
                return (
                    <input
                        type="text"
                        placeholder={question.placeholder || "Enter your answer..."}
                        value={(responses[question.id] as string) || ""}
                        onChange={(e) => updateResponse(question.id, e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:ring-2 focus:ring-[#007b8a] focus:border-transparent transition-all outline-none"
                    />
                );

            case "paragraph":
                return (
                    <textarea
                        placeholder={question.placeholder || "Enter your answer..."}
                        rows={4}
                        value={(responses[question.id] as string) || ""}
                        onChange={(e) => updateResponse(question.id, e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:ring-2 focus:ring-[#007b8a] focus:border-transparent transition-all outline-none resize-none"
                    />
                );

            case "radio":
                return (
                    <div className="space-y-3">
                        {question.options?.map((option) => (
                            <label
                                key={option}
                                className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-all group"
                            >
                                <div className="relative flex items-center justify-center w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-600 group-hover:border-[#007b8a] transition-colors">
                                    <input
                                        type="radio"
                                        name={question.id}
                                        value={option}
                                        checked={responses[question.id] === option}
                                        onChange={() => updateResponse(question.id, option)}
                                        className="sr-only"
                                    />
                                    {responses[question.id] === option && (
                                        <div className="w-2.5 h-2.5 rounded-full bg-[#007b8a]" />
                                    )}
                                </div>
                                <span className="text-zinc-700 dark:text-zinc-300">{option}</span>
                            </label>
                        ))}
                    </div>
                );

            case "checkbox":
                return (
                    <div className="space-y-3">
                        {question.options?.map((option) => {
                            const isChecked = ((responses[question.id] as string[]) || []).includes(option);
                            return (
                                <label
                                    key={option}
                                    className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-all group"
                                >
                                    <div
                                        className={`relative flex items-center justify-center w-5 h-5 rounded-md border-2 transition-colors ${isChecked
                                            ? "bg-[#007b8a] border-[#007b8a] dark:bg-[#007b8a] dark:border-[#007b8a]"
                                            : "border-zinc-300 dark:border-zinc-600 group-hover:border-[#007b8a]"
                                            }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={(e) => handleCheckboxChange(question.id, option, e.target.checked)}
                                            className="sr-only"
                                        />
                                        {isChecked && (
                                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                            </svg>
                                        )}
                                    </div>
                                    <span className="text-zinc-700 dark:text-zinc-300">{option}</span>
                                </label>
                            );
                        })}
                    </div>
                );

            case "dropdown":
                return (
                    <div className="relative">
                        <select
                            value={(responses[question.id] as string) || ""}
                            onChange={(e) => updateResponse(question.id, e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-900 dark:text-white focus:ring-2 focus:ring-[#007b8a] focus:border-transparent transition-all outline-none appearance-none cursor-pointer"
                        >
                            <option value="" disabled>Select an option...</option>
                            {question.options?.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                            <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </div>
                );

            case "linear_scale":
                return (
                    <div className="space-y-3">
                        <div className="flex justify-between text-sm text-zinc-500 dark:text-zinc-400">
                            <span>{question.minLabel}</span>
                            <span>{question.maxLabel}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                            {Array.from({ length: (question.max || 5) - (question.min || 1) + 1 }, (_, i) => i + (question.min || 1)).map(
                                (num) => (
                                    <button
                                        key={num}
                                        type="button"
                                        onClick={() => updateResponse(question.id, num)}
                                        className={`flex-1 py-3 rounded-xl border-2 font-medium transition-all ${responses[question.id] === num
                                            ? "bg-[#007b8a] border-[#007b8a] text-white"
                                            : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-[#007b8a] hover:text-[#007b8a] dark:hover:text-[#007b8a]"
                                            }`}
                                    >
                                        {num}
                                    </button>
                                )
                            )}
                        </div>
                    </div>
                );

            case "star_rating":
                return (
                    <div className="flex gap-2">
                        {Array.from({ length: question.max || 5 }, (_, i) => i + 1).map((star) => (
                            <button
                                key={star}
                                type="button"
                                onClick={() => updateResponse(question.id, star)}
                                className="p-1 transition-transform hover:scale-110"
                            >
                                <svg
                                    className={`w-10 h-10 transition-colors ${(responses[question.id] as number) >= star
                                        ? "text-yellow-400 fill-yellow-400"
                                        : "text-zinc-300 dark:text-zinc-600"
                                        }`}
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={1.5}
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                                    />
                                </svg>
                            </button>
                        ))}
                    </div>
                );

            case "grid_radio":
            case "grid_checkbox":
                const isCheckboxGrid = question.type === "grid_checkbox";
                return (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[500px]">
                            <thead>
                                <tr>
                                    <th className="p-3 text-left text-sm font-medium text-zinc-500 dark:text-zinc-400"></th>
                                    {question.columns?.map((col) => (
                                        <th key={col} className="p-3 text-center text-sm font-medium text-zinc-600 dark:text-zinc-300">
                                            {col}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {question.rows?.map((row, rowIndex) => (
                                    <tr
                                        key={row}
                                        className={rowIndex % 2 === 0 ? "bg-zinc-50 dark:bg-zinc-800/30" : ""}
                                    >
                                        <td className="p-3 text-sm text-zinc-700 dark:text-zinc-300 font-medium">{row}</td>
                                        {question.columns?.map((col) => {
                                            const gridData = (responses[question.id] as Record<string, string | string[]>) || {};
                                            const isSelected = isCheckboxGrid
                                                ? ((gridData[row] as string[]) || []).includes(col)
                                                : gridData[row] === col;
                                            return (
                                                <td key={col} className="p-3 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleGridChange(question.id, row, col, isCheckboxGrid)}
                                                        className={`w-6 h-6 rounded-${isCheckboxGrid ? "md" : "full"} border-2 transition-all inline-flex items-center justify-center ${isSelected
                                                            ? "bg-[#007b8a] border-[#007b8a] dark:bg-[#007b8a] dark:border-[#007b8a]"
                                                            : "border-zinc-300 dark:border-zinc-600 hover:border-[#007b8a]"
                                                            }`}
                                                    >
                                                        {isSelected && (
                                                            isCheckboxGrid ? (
                                                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            ) : (
                                                                <div className="w-2.5 h-2.5 rounded-full bg-white" />
                                                            )
                                                        )}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );

            case "date":
                return (
                    <input
                        type="date"
                        value={(responses[question.id] as string) || ""}
                        onChange={(e) => updateResponse(question.id, e.target.value)}
                        className="w-full max-w-xs px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-900 dark:text-white focus:ring-2 focus:ring-[#007b8a] focus:border-transparent transition-all outline-none"
                    />
                );

            case "time":
                return (
                    <input
                        type="time"
                        value={(responses[question.id] as string) || ""}
                        onChange={(e) => updateResponse(question.id, e.target.value)}
                        className="w-full max-w-xs px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-900 dark:text-white focus:ring-2 focus:ring-[#007b8a] focus:border-transparent transition-all outline-none"
                    />
                );

            case "datetime":
                return (
                    <div className="flex flex-wrap gap-3">
                        <input
                            type="date"
                            value={((responses[question.id] as { date?: string })?.date) || ""}
                            onChange={(e) =>
                                updateResponse(question.id, {
                                    ...(responses[question.id] as object),
                                    date: e.target.value,
                                })
                            }
                            className="px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-900 dark:text-white focus:ring-2 focus:ring-[#007b8a] focus:border-transparent transition-all outline-none"
                        />
                        <input
                            type="time"
                            value={((responses[question.id] as { time?: string })?.time) || ""}
                            onChange={(e) =>
                                updateResponse(question.id, {
                                    ...(responses[question.id] as object),
                                    time: e.target.value,
                                })
                            }
                            className="px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-900 dark:text-white focus:ring-2 focus:ring-[#007b8a] focus:border-transparent transition-all outline-none"
                        />
                    </div>
                );

            case "duration":
                return (
                    <div className="flex flex-wrap gap-3 items-center">
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="0"
                                placeholder="0"
                                value={((responses[question.id] as { hours?: number })?.hours) || ""}
                                onChange={(e) =>
                                    updateResponse(question.id, {
                                        ...(responses[question.id] as object),
                                        hours: parseInt(e.target.value) || 0,
                                    })
                                }
                                className="w-20 px-3 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-900 dark:text-white focus:ring-2 focus:ring-[#007b8a] focus:border-transparent transition-all outline-none text-center"
                            />
                            <span className="text-zinc-500 dark:text-zinc-400 text-sm">hrs</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="0"
                                max="59"
                                placeholder="0"
                                value={((responses[question.id] as { minutes?: number })?.minutes) || ""}
                                onChange={(e) =>
                                    updateResponse(question.id, {
                                        ...(responses[question.id] as object),
                                        minutes: parseInt(e.target.value) || 0,
                                    })
                                }
                                className="w-20 px-3 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-900 dark:text-white focus:ring-2 focus:ring-[#007b8a] focus:border-transparent transition-all outline-none text-center"
                            />
                            <span className="text-zinc-500 dark:text-zinc-400 text-sm">mins</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="0"
                                max="59"
                                placeholder="0"
                                value={((responses[question.id] as { seconds?: number })?.seconds) || ""}
                                onChange={(e) =>
                                    updateResponse(question.id, {
                                        ...(responses[question.id] as object),
                                        seconds: parseInt(e.target.value) || 0,
                                    })
                                }
                                className="w-20 px-3 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-900 dark:text-white focus:ring-2 focus:ring-[#007b8a] focus:border-transparent transition-all outline-none text-center"
                            />
                            <span className="text-zinc-500 dark:text-zinc-400 text-sm">secs</span>
                        </div>
                    </div>
                );

            default:
                return <p className="text-zinc-500">Unsupported question type: {question.type}</p>;
        }
    };

    // Loading state
    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#007b8a]"></div>
            </div>
        );
    }

    if (!formData) {
        return (
            <div className="text-center py-12">
                <p className="text-red-500">Failed to load form. Please refresh the page.</p>
            </div>
        );
    }

    // Success state
    if (success) {
        return (
            <div className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
                <div className="bg-gradient-to-r from-green-600 to-emerald-600 px-8 py-10 text-center">
                    <div className="mx-auto w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-4">
                        <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h3 className="text-2xl font-bold text-white">Application Submitted!</h3>
                    <p className="mt-2 text-green-100">Thank you for applying. We'll review your submission and get back to you soon.</p>
                </div>
                <div className="p-8 text-center">
                    <p className="text-zinc-600 dark:text-zinc-400">
                        A confirmation has been sent to your email.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
            {/* Error banner */}
            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 p-3 text-center">
                    <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
                </div>
            )}

            {/* Form Header */}
            <div className="relative overflow-hidden bg-black px-8 py-16 text-center border-b border-zinc-800">
                {/* Subtle Background Pattern */}
                <div className="absolute inset-0 opacity-10 pointer-events-none" 
                     style={{ backgroundImage: 'radial-gradient(#007b8a 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
                
                <h3 className="relative z-10 text-3xl sm:text-4xl font-black tracking-tighter uppercase text-white mb-2">
                    {formData.title}
                </h3>
                <p className="relative z-10 text-zinc-400 font-medium tracking-wide uppercase text-sm">
                    {formData.description}
                </p>
                {session && (
                    <div className="relative z-10 mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/50 border border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#007b8a]" />
                        {session.user?.email}
                    </div>
                )}
            </div>

            {/* Questions */}
            <div className="p-6 sm:p-8 space-y-0 divide-y divide-zinc-200 dark:divide-zinc-800">
                {formData.questions.map((question, index) => (
                    <div
                        key={question.id}
                        className="py-8 first:pt-0 last:pb-0"
                    >
                        <label className="block mb-4">
                            <span className="text-xs font-medium text-[#007b8a] dark:text-[#007b8a] uppercase tracking-wide">
                                Question {index + 1}
                            </span>
                            <h4 className="mt-1 text-lg font-medium text-zinc-900 dark:text-white">
                                {question.label}
                                {question.required && <span className="text-red-500 ml-1">*</span>}
                            </h4>
                        </label>
                        {renderQuestion(question)}
                    </div>
                ))}
            </div>

            {/* Submit Button */}
            <div className="p-6 sm:p-8 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-800">
                <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="group relative w-full py-4 px-8 bg-[#007b8a] text-white font-bold text-lg rounded-full overflow-hidden transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_25px_rgba(0,123,138,0.3)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-3 uppercase tracking-wider"
                >
                    <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                    <span className="relative z-10 flex items-center gap-3">
                        {submitting ? (
                            <>
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                Submitting...
                            </>
                        ) : session ? (
                            <>
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                Submit Application
                            </>
                        ) : (
                            <>
                                <svg className="w-5 h-5" viewBox="0 0 24 24">
                                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                </svg>
                                Sign in with Google
                            </>
                        )}
                    </span>
                </button>
                <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
                    {session
                        ? "Your application will be submitted to Google Forms"
                        : "You'll be asked to sign in with Google to submit your application"
                    }
                </p>
            </div>
        </div>
    );
}
