/**
 * publish.js
 * Reads a markdown file, extracts frontmatter, and publishes/updates it on dev.to.
 *
 * Usage: node publish.js <path-to-article.md>
 *
 * Frontmatter fields supported:
 *   title       (required)
 *   published   (boolean, default: false)
 *   tags        (comma-separated string or array)
 *   description (optional)
 *   cover_image (optional, URL)
 *   series      (optional)
 *   devto_id    (optional — if set, the script will UPDATE instead of CREATE)
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import fetch from "node-fetch";

const API_KEY = process.env.DEVTO_API_KEY;
const BASE_URL = "https://dev.to/api";

if (!API_KEY) {
  console.error("ERROR: DEVTO_API_KEY environment variable is not set.");
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("ERROR: No file path provided. Usage: node publish.js <path>");
  process.exit(1);
}

const absolutePath = path.resolve(filePath);
if (!fs.existsSync(absolutePath)) {
  console.error(`ERROR: File not found: ${absolutePath}`);
  process.exit(1);
}

const raw = fs.readFileSync(absolutePath, "utf8");
const { data: frontmatter, content } = matter(raw);

if (!frontmatter.title) {
  console.error(`ERROR: Missing 'title' in frontmatter for ${filePath}`);
  process.exit(1);
}

// Normalize tags: accept array or comma-separated string
let tags = [];
if (Array.isArray(frontmatter.tags)) {
  tags = frontmatter.tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, ""));
} else if (typeof frontmatter.tags === "string") {
  tags = frontmatter.tags.split(",").map((t) => t.trim().toLowerCase().replace(/\s+/g, ""));
}

// Build the article payload
const articlePayload = {
  article: {
    title: frontmatter.title,
    body_markdown: content,
    published: frontmatter.published === true,
    tags,
    ...(frontmatter.description && { description: frontmatter.description }),
    ...(frontmatter.cover_image && { main_image: frontmatter.cover_image }),
    ...(frontmatter.series && { series: frontmatter.series }),
  },
};

const isUpdate = !!frontmatter.devto_id;
const method = isUpdate ? "PUT" : "POST";
const url = isUpdate
  ? `${BASE_URL}/articles/${frontmatter.devto_id}`
  : `${BASE_URL}/articles`;

console.log(`${isUpdate ? "UPDATING" : "CREATING"} article: "${frontmatter.title}"`);
console.log(`File: ${filePath}`);
console.log(`Published: ${articlePayload.article.published}`);
console.log(`Tags: ${tags.join(", ")}`);

try {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "api-key": API_KEY,
      accept: "application/vnd.forem.api-v1+json",
    },
    body: JSON.stringify(articlePayload),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error(`API ERROR (${response.status}):`, JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(`SUCCESS! Article ${isUpdate ? "updated" : "created"}.`);
  console.log(`dev.to URL: ${result.url}`);
  console.log(`dev.to ID:  ${result.id}`);

  if (!isUpdate) {
    console.log(`\nIMPORTANT: Add this to your frontmatter to enable future updates:`);
    console.log(`devto_id: ${result.id}`);
  }
} catch (err) {
  console.error("NETWORK ERROR:", err.message);
  process.exit(1);
}
