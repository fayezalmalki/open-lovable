import { NextRequest, NextResponse } from 'next/server';
import { getConfiguredEnvValue } from '@/lib/env';

// Function to sanitize smart quotes and other problematic characters
function sanitizeQuotes(text: string): string {
  return text
    // Replace smart single quotes
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    // Replace smart double quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // Replace other quote-like characters
    .replace(/[\u00AB\u00BB]/g, '"') // Guillemets
    .replace(/[\u2039\u203A]/g, "'") // Single guillemets
    // Replace other problematic characters
    .replace(/[\u2013\u2014]/g, '-') // En dash and em dash
    .replace(/[\u2026]/g, '...') // Ellipsis
    .replace(/[\u00A0]/g, ' '); // Non-breaking space
}

function normalizeUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).toString();
  } catch {
    return new URL(`https://${rawUrl}`).toString();
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(html: string): string {
  return sanitizeQuotes(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<\/(p|div|section|article|main|header|footer|li|ul|ol|h1|h2|h3|h4|h5|h6|br)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractFirstMatch(html: string, pattern: RegExp): string {
  const match = html.match(pattern);
  return match?.[1] ? sanitizeQuotes(decodeHtmlEntities(match[1].trim())) : '';
}

function extractAllMatches(html: string, pattern: RegExp, limit: number): string[] {
  const matches = Array.from(html.matchAll(pattern))
    .map((match) => sanitizeQuotes(decodeHtmlEntities((match[1] || '').trim())))
    .filter(Boolean);

  return matches.slice(0, limit);
}

function extractImageUrls(html: string, baseUrl: string, limit: number): string[] {
  const urls = new Set<string>();

  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const src = match[1]?.trim();
    if (!src) {
      continue;
    }

    try {
      urls.add(new URL(src, baseUrl).toString());
    } catch {
      continue;
    }

    if (urls.size >= limit) {
      break;
    }
  }

  return Array.from(urls);
}

async function scrapeWithHtmlFallback(url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'open-lovable/1.0 (+https://github.com/firecrawl/open-lovable)'
    }
  });

  if (!response.ok) {
    throw new Error(`Fallback HTML fetch failed with status ${response.status}`);
  }

  const html = await response.text();
  const title =
    extractFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
    new URL(url).hostname;
  const description = extractFirstMatch(
    html,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i
  );
  const headings = extractAllMatches(html, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, 12);
  const imageUrls = extractImageUrls(html, url, 12);
  const plainText = stripHtml(html).slice(0, 20000);

  const sections = [
    `Title: ${title}`,
    description ? `Description: ${description}` : '',
    `URL: ${url}`,
    headings.length > 0 ? `Headings:\n- ${headings.join('\n- ')}` : '',
    imageUrls.length > 0 ? `Images:\n- ${imageUrls.join('\n- ')}` : '',
    `Main Content:\n${plainText || 'No readable text content was extracted from the HTML.'}`
  ].filter(Boolean);

  const formattedContent = sections.join('\n\n');

  return {
    success: true,
    url,
    content: formattedContent,
    screenshot: null,
    structured: {
      title,
      description,
      content: plainText,
      url,
      screenshot: null,
      headings,
      images: imageUrls
    },
    metadata: {
      scraper: 'html-fallback',
      timestamp: new Date().toISOString(),
      contentLength: formattedContent.length,
      cached: false,
      fallback: true
    },
    message: 'URL scraped with HTML fallback'
  };
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    
    if (!url) {
      return NextResponse.json({
        success: false,
        error: 'URL is required'
      }, { status: 400 });
    }
    
    const normalizedUrl = normalizeUrl(url);
    console.log('[scrape-url-enhanced] Scraping:', normalizedUrl);
    
    const firecrawlApiKey = getConfiguredEnvValue('FIRECRAWL_API_KEY');
    if (!firecrawlApiKey) {
      console.warn('[scrape-url-enhanced] FIRECRAWL_API_KEY is unavailable, using HTML fallback');
      return NextResponse.json(await scrapeWithHtmlFallback(normalizedUrl));
    }

    try {
      const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: normalizedUrl,
          formats: ['markdown', 'html', 'screenshot'],
          waitFor: 3000,
          timeout: 30000,
          blockAds: true,
          maxAge: 3600000,
          actions: [
            {
              type: 'wait',
              milliseconds: 2000
            },
            {
              type: 'screenshot',
              fullPage: false
            }
          ]
        })
      });
      
      if (!firecrawlResponse.ok) {
        const error = await firecrawlResponse.text();
        throw new Error(`Firecrawl API error: ${error}`);
      }
      
      const data = await firecrawlResponse.json();
      
      if (!data.success || !data.data) {
        throw new Error('Failed to scrape content');
      }
      
      const { markdown, metadata, screenshot, actions } = data.data;
      const screenshotUrl = screenshot || actions?.screenshots?.[0] || null;
      const sanitizedMarkdown = sanitizeQuotes(markdown || '');
      const title = metadata?.title || '';
      const description = metadata?.description || '';
      const formattedContent = `
Title: ${sanitizeQuotes(title)}
Description: ${sanitizeQuotes(description)}
URL: ${normalizedUrl}

Main Content:
${sanitizedMarkdown}
      `.trim();
      
      return NextResponse.json({
        success: true,
        url: normalizedUrl,
        content: formattedContent,
        screenshot: screenshotUrl,
        structured: {
          title: sanitizeQuotes(title),
          description: sanitizeQuotes(description),
          content: sanitizedMarkdown,
          url: normalizedUrl,
          screenshot: screenshotUrl
        },
        metadata: {
          scraper: 'firecrawl-enhanced',
          timestamp: new Date().toISOString(),
          contentLength: formattedContent.length,
          cached: data.data.cached || false,
          ...metadata
        },
        message: 'URL scraped successfully with Firecrawl (with caching for 500% faster performance)'
      });
    } catch (firecrawlError) {
      const message = firecrawlError instanceof Error ? firecrawlError.message : String(firecrawlError);
      console.warn('[scrape-url-enhanced] Firecrawl failed, using HTML fallback:', message);

      const fallbackResponse = await scrapeWithHtmlFallback(normalizedUrl);
      return NextResponse.json({
        ...fallbackResponse,
        metadata: {
          ...fallbackResponse.metadata,
          firecrawlError: message
        },
        message: 'URL scraped with HTML fallback after Firecrawl failed'
      });
    }
    
  } catch (error) {
    console.error('[scrape-url-enhanced] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
