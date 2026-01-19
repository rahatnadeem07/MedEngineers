import { NextResponse } from "next/server";

export async function GET() {
    try {
        const publishedId = process.env.GOOGLE_FORM_PUBLISHED_ID;
        const url = `https://docs.google.com/forms/d/e/${publishedId}/viewform`;
        const res = await fetch(url);
        const html = await res.text();
        const regex = /var FB_PUBLIC_LOAD_DATA_ = (.*?);/;
        const match = html.match(regex);

        if (!match) return NextResponse.json({ error: "No data found" });

        const data = JSON.parse(match[1]);
        const questions = data[1][1];

        // Find the grid question "Desktop/Laptop"
        const gridItem = questions.find((q: any) => q[1] === "Desktop/Laptop");

        return NextResponse.json({
            gridItemStructure: gridItem
        });
    } catch (e) {
        return NextResponse.json({ error: String(e) });
    }
}
