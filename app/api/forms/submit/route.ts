import { NextRequest, NextResponse } from "next/server";
import { getPublicEntryIds } from "@/lib/google-forms";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { responses } = body;
        const publishedFormId = process.env.GOOGLE_FORM_PUBLISHED_ID;

        if (!publishedFormId) {
            return NextResponse.json(
                { error: "Server configuration error: Missing Form ID" },
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
        // We look up the Grid Title in the map, which should return an object of RowLabel -> ID
        const findEntryIdForGridRow = (gridTitleId: string, rowLabel: string): string | null => {
            // Reverse lookup: We have the ID (gridTitleId), we need to find the Title
            // Then look up the row map.
            // Actually, we received 'responses' keyed by Question ID (which is the main ID).
            // For Grids, the main ID is usually the Grid Header ID.

            // Iterate map to find entry matching our ID
            for (const [title, entryData] of entryIdMap.entries()) {
                if (typeof entryData === 'object') {
                    // Check if this grid's "header" ID matches? 
                    // Actually, our API returns "grid_ITEMID" or specific ID for grids.
                    // The frontend sends what we gave it.

                    // IF the key matches a known title's top-level ID?
                    // But for IDs that are objects, what is the key in 'responses'?
                    // It's the ID we assigned in route.ts.

                    // Heuristic: Check if the key provided in responses matches any known Row Map values?
                    // No, key is the Question ID.

                    // The easiest way is if we can link the 'key' (QuestionID) back to the 'Title'.
                    // Since we don't have that link easily here without fetching form structure again...

                    // WAIT: The frontend sends responses keyed by the ID we sent it.
                    // In route.ts, we used: id: "grid_" + item.itemId OR scraper ID.

                    // So if it's a grid, and we successfully scraped it, entryData is an object.
                    // So ID becomes "grid_" + item.itemId.

                    // This means 'key' in responses is "grid_...". 
                    // We can't lookup by "grid_...". We need to Match Title.

                    // STRATEGY: 
                    // We need to match the responses key to the Form Item Title?
                    // We can't easily.

                    // BETTER STRATEGY:
                    // Just look for ANY grid in our map that contains the row label?
                    // That's risky if two grids have same row labels.

                    // CORRECT STRATEGY:
                    // We need to fetch the Form Structure (via API) to map IDs to Titles first?
                    // That's slow.

                    // ALTERNATIVE:
                    // Iterate over all entries in entryIdMap. 
                    // If it's a grid (object), check if it has the row label we are trying to submit.
                    // If yes, use that ID.

                    if (entryData[rowLabel]) {
                        return entryData[rowLabel];
                    }
                }
            }
            return null;
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
                    // Assume Grid: Keys are Row Labels, Values are Column Values
                    Object.entries(valObj).forEach(([rowLabel, colVal]) => {
                        // Find ID for this Row Label
                        // We pass the Question Key (key) but mostly we rely on matching the label
                        const rowEntryId = findEntryIdForGridRow(key, rowLabel);

                        if (rowEntryId) {
                            if (Array.isArray(colVal)) {
                                colVal.forEach(c => submitData.append(`entry.${rowEntryId}`, String(c)));
                            } else {
                                submitData.append(`entry.${rowEntryId}`, String(colVal));
                            }
                        } else {
                            console.warn(`Could not find Entry ID for Grid Row: ${rowLabel}`);
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

        console.log("--- SUBMISSION DEBUG V3 ---");
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
            response: errorText
        });

        return NextResponse.json(
            {
                error: `Form submission failed with status ${submitResponse.status}`,
                details: errorText.substring(0, 500) // First 500 chars 
            },
            { status: 500 }
        );
    } catch (error) {
        console.error("Error submitting form:", error);
        return NextResponse.json(
            { error: "Failed to submit form", details: String(error) },
            { status: 500 }
        );
    }
}
