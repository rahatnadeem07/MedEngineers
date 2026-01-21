import { google } from "googleapis";
import { NextResponse } from "next/server";

// Form structure types
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

import { getPublicEntryIds } from "@/lib/google-forms";

export async function GET() {
    try {
        const formId = process.env.GOOGLE_FORM_ID;
        const publishedId = process.env.GOOGLE_FORM_PUBLISHED_ID;

        if (!formId || !publishedId) {
            return NextResponse.json(
                { error: "Form ID or Published ID not configured" },
                { status: 500 }
            );
        }

        // 1. Fetch Entry IDs from public HTML (for submission)
        const entryIdMap = await getPublicEntryIds(publishedId);

        // 2. Fetch Form Structure from API (for types/options)
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n"),
            },
            scopes: ["https://www.googleapis.com/auth/forms.body.readonly"],
        });

        const forms = google.forms({ version: "v1", auth });
        const response = await forms.forms.get({ formId });
        const form = response.data;

        // 3. Transform & Merge
        const formData: FormData = {
            title: form.info?.title || "Application Form",
            description: form.info?.description || "",
            questions: [],
        };

        if (form.items) {
            for (const item of form.items) {
                // Skip non-question items (like page breaks, headers)
                if (!item.questionItem && !item.questionGroupItem) continue;

                const title = item.title || "";
                
                // Get list of IDs for this title and pop the first one (FIFO)
                const entryList = entryIdMap.get(title);
                const entryData = entryList && entryList.length > 0 ? entryList.shift() : undefined;
                
                const submissionId = typeof entryData === 'string' ? entryData : item.itemId || "";

                if (item.questionItem) {
                    const question = item.questionItem.question;
                    if (!question) continue;

                    const baseQuestion: FormQuestion = {
                        id: submissionId,
                        type: "short_answer",
                        label: title,
                        required: question.required || false,
                    };

                    // Determine question type from API data
                    if (question.textQuestion) {
                        baseQuestion.type = question.textQuestion.paragraph ? "paragraph" : "short_answer";
                        baseQuestion.placeholder = "Enter your answer...";
                    } else if (question.choiceQuestion) {
                        const choiceQ = question.choiceQuestion;
                        if (choiceQ.type === "RADIO") {
                            baseQuestion.type = "radio";
                        } else if (choiceQ.type === "CHECKBOX") {
                            baseQuestion.type = "checkbox";
                        } else if (choiceQ.type === "DROP_DOWN") {
                            baseQuestion.type = "dropdown";
                        }
                        baseQuestion.options = choiceQ.options?.map((o) => o.value || "") || [];
                    } else if (question.scaleQuestion) {
                        baseQuestion.type = "linear_scale";
                        baseQuestion.min = question.scaleQuestion.low || 1;
                        baseQuestion.max = question.scaleQuestion.high || 5;
                        baseQuestion.minLabel = question.scaleQuestion.lowLabel || "";
                        baseQuestion.maxLabel = question.scaleQuestion.highLabel || "";
                    } else if (question.ratingQuestion) {
                        // Handle STAR rating
                        baseQuestion.type = "star_rating";
                        baseQuestion.max = question.ratingQuestion.ratingScaleLevel || 5;
                    } else if (question.dateQuestion) {
                        baseQuestion.type = question.dateQuestion.includeTime ? "datetime" : "date";
                    } else if (question.timeQuestion) {
                        baseQuestion.type = question.timeQuestion.duration ? "duration" : "time";
                    }

                    formData.questions.push(baseQuestion);
                }

                // Handle Grid Questions
                else if (item.questionGroupItem) {
                    const grid = item.questionGroupItem;
                    const isCheckbox = grid.grid?.columns?.type === "CHECKBOX";

                    // Attach the Row IDs map if available
                    // We'll pass it as 'rowIds' in the question
                    // Frontend doesn't need to change if we handle the mapping in submit route
                    // BUT for now we just want to ensure we have the data here

                    // If we got a grid object back (not string), use it
                    // The entryData logic above handles FIFO for grids too if titles matched
                    
                    const gridQuestion: FormQuestion = {
                        id: typeof entryData === 'string' ? entryData : "grid_" + item.itemId, // Identify as grid
                        type: isCheckbox ? "grid_checkbox" : "grid_radio",
                        label: title,
                        required: false,
                        rows: grid.questions?.map((q) => q.rowQuestion?.title || "") || [],
                        columns: grid.grid?.columns?.options?.map((o) => o.value || "") || [],
                    };

                    // We can't easily pass the Row Map to the client without changing the type definition
                    // So we will rely on re-scraping in the submit route to get the Row ID map.

                    formData.questions.push(gridQuestion);
                }
            }
        }

        return NextResponse.json(formData);
    } catch (error) {
        console.error("Error fetching form:", error);
        return NextResponse.json(
            { error: "Failed to fetch form", details: String(error) },
            { status: 500 }
        );
    }
}
