import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fill, getSite } from "@/lib/site";

const SLUGS = ["terms", "privacy", "refunds", "shipping"];
export function generateStaticParams() { return SLUGS.map((slug) => ({ slug })); }
export const revalidate = 300;
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { content } = await getSite();
  return { title: content[`legal.${params.slug}`]?.title };
}

export default async function Legal({ params }: { params: { slug: string } }) {
  if (!SLUGS.includes(params.slug)) notFound();
  const { content, biz } = await getSite();
  const page = content[`legal.${params.slug}`];
  const blocks = fill(page.body, biz).split(/\n\s*\n/).map((b: string) => b.trim()).filter(Boolean);
  return (
    <main className="wrap page legal">
      <h1>{page.title}</h1>
      {page.updated && <p className="muted">Last updated: {page.updated}</p>}
      {blocks.map((b: string, i: number) => b.startsWith("## ") ? <h2 key={i} style={{ fontSize: "1.2rem" }}>{b.slice(3).split("\n")[0]}</h2> : <p key={i} style={{ whiteSpace: "pre-line" }}>{b}</p>)}
    </main>
  );
}
