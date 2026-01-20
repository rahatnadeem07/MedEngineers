import { NextRequest, NextResponse } from "next/server";
import { getPublicEntryIds } from "@/lib/google-forms";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { responses, type = "competitor" } = body;

        const publishedFormId = type === "attendee"
            ? process.env.ATTENDEE_FORM_PUBLISHED_ID
            : process.env.GOOGLE_FORM_PUBLISHED_ID;

        if (!publishedFormId) {
            return NextResponse.json(
                { error: `Server configuration error: Missing Published Form ID for '${type}'` },
                { status: 500 }
            );
        }

        // 1. Re-scrape entry IDs so we have the map (including Grid Rows) AND get the HTML body for fbzx
        // We modify getPublicEntryIds in lib/google-forms.ts to return HTML as well, 
        // OR we just fetch it here separately since we need the fbzx token from the raw HTML.
        const formUrl = `https://docs.google.com/forms/d/e/${publishedFormId}/viewform`;
        const res = await fetch(formUrl);
        const htmlText = await res.text();

        // Extract Entry IDs (we can still use our lib or just parse here if we want everything in one place, 
        // but let's stick to using the lib for mapping and just use htmlText for fbzx)
        const entryIdMap = await getPublicEntryIds(publishedFormId);

        // Helper to extract fbzx
        const getFbzx = (html: string): string => {
            const match = html.match(/name="fbzx"\s+value="([^"]+)"/);
            return match ? match[1] : "";
        };

        const fbzx = getFbzx(htmlText);

        // 2. Prepare the payload associated with the published form
        const submitUrl = `https://docs.google.com/forms/d/e/${publishedFormId}/formResponse`;
        const submitData = new URLSearchParams();

        // Add pageHistory (required for some forms)
        submitData.append('pageHistory', '0');
        // Add fvv (required token)
        submitData.append('fvv', '1');
        // Add fbzx (anti-CSRF token)
        if (fbzx) {
            submitData.append('fbzx', fbzx);
        }

        // Helper to find Row ID for a Grid Question
        const findEntryIdForGridRow = (gridTitleId: string, rowLabel: string): string | null => {
            // Because we now pass the Row Entry ID directly from the frontend (which got it from route.ts),
            // we ironically don't need to look it up here anymore if the frontend is sending the correct ID.
            // However, just in case, we can keep the logic or rely on the frontend payload.

            // Actually, based on line 113 below: `Object.entries(valObj).forEach(([rowEntryId, colVal])`
            // The frontend is sending the ID as the key. So we TRUST the frontend ID.
            return null; // logic not used in current flow
        };

        // Loop through incoming answers
        Object.entries(responses).forEach(([key, value]) => {
            // value can be String, Array (Checkbox), or Object (Grid/Date)

            if (Array.isArray(value)) {
                // Checkboxes: plain append
                value.forEach(item => submitData.append(`entry.${key}`, String(item)));
            }
            else if (typeof value === 'object' && value !== null) {
                // Complex types: Date, Time, Duration, Grid
                const valObj = value as Record<string, any>;

                // 1. Check for Grid (Keys are Arbitrary Strings like "Row Label")
                //    Vs Date (Keys are "date", "time", "year" etc)

                const isDate = 'date' in valObj || 'year' in valObj;
                const isTime = 'time' in valObj || ('hours' in valObj && 'minutes' in valObj);

                if (isDate || isTime) {
                    // Handle Date/Time
                    // Date: YYYY-MM-DD
                    if (valObj.date) {
                        const [y, m, d] = valObj.date.split('-');
                        submitData.append(`entry.${key}_year`, y);
                        submitData.append(`entry.${key}_month`, m);
                        submitData.append(`entry.${key}_day`, d);
                    }
                    // Time: HH:MM
                    if (valObj.time) {
                        const [h, min] = valObj.time.split(':');
                        submitData.append(`entry.${key}_hour`, h);
                        submitData.append(`entry.${key}_minute`, min);
                    }
                    // Duration: { hours, minutes, seconds }
                    if ('hours' in valObj) {
                        submitData.append(`entry.${key}_hour`, String(valObj.hours));
                        submitData.append(`entry.${key}_minute`, String(valObj.minutes));
                        submitData.append(`entry.${key}_second`, String(valObj.seconds || 0));
                    }
                } else {
                    // Grid: Keys are Row Entry IDs !! (Thanks to our frontend update)
                    // Values are Column Values
                    Object.entries(valObj).forEach(([rowEntryId, colVal]) => {
                        // rowEntryId comes directly from the frontend (which got it from route.ts)
                        if (Array.isArray(colVal)) {
                            colVal.forEach(c => submitData.append(`entry.${rowEntryId}`, String(c)));
                        } else {
                            submitData.append(`entry.${rowEntryId}`, String(colVal));
                        }
                    });
                }
            }
            else {
                // Simple string value - but check if it's a date/time pattern
                const strValue = String(value);

                // Detect date pattern: YYYY-MM-DD
                const dateMatch = strValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (dateMatch) {
                    submitData.append(`entry.${key}_year`, dateMatch[1]);
                    submitData.append(`entry.${key}_month`, dateMatch[2]);
                    submitData.append(`entry.${key}_day`, dateMatch[3]);
                    return;
                }

                // Detect time pattern: HH:MM
                const timeMatch = strValue.match(/^(\d{2}):(\d{2})$/);
                if (timeMatch) {
                    submitData.append(`entry.${key}_hour`, timeMatch[1]);
                    submitData.append(`entry.${key}_minute`, timeMatch[2]);
                    return;
                }

                // Regular string
                submitData.append(`entry.${key}`, strValue);
            }
        });

        console.log("--- SUBMISSION DEBUG V4 ---");
        console.log("Target URL:", submitUrl);
        console.log("Payload:", Object.fromEntries(submitData));
        console.log("---------------------------");

        const submitResponse = await fetch(submitUrl, {
            method: "POST",
            body: submitData,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        // Google Forms returns a redirect on success, so we check for 200 or redirect
        if (submitResponse.ok || submitResponse.status === 302 || submitResponse.status === 303) {
            return NextResponse.json({
                success: true,
                message: "Form submitted successfully!"
            });
        }

        // If we get here, something went wrong
        const errorText = await submitResponse.text();
        console.error("Google Forms Submission Failed:", {
            status: submitResponse.status,
            statusText: submitResponse.statusText,
            url: submitUrl,
            params: Object.fromEntries(submitData),
            response: errorText
        });

        // Return the error details to the client
        return NextResponse.json(
            {
                error: `Form submission failed with status ${submitResponse.status}`,
                details: errorText, // Send full text, might be HTML but contains clues
                debugPayload: Object.fromEntries(submitData) // Helping debug
            },
            { status: submitResponse.status } // Propagate the status code (e.g. 400)
        );
    } catch (error) {
        console.error("Error submitting form:", error);
        return NextResponse.json(
            { error: "Failed to submit form", details: String(error) },
            { status: 500 }
        );
    }
}
