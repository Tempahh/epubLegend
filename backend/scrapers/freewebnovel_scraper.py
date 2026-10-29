#!/usr/bin/env python3
"""
Beautiful Soup-based scraper for freewebnovel.com.
Extracts search results and chapters with metadata, atomic file writes, and rate limiting.
Outputs JSON to stdout for Node.js subprocess integration.
"""

import argparse
import json
import os
import sys
import time
import re
from typing import Optional, Dict, List, Any
from pathlib import Path
from urllib.parse import urljoin
from datetime import datetime
from tempfile import NamedTemporaryFile

import requests
from bs4 import BeautifulSoup


# Configuration
DEFAULT_RATE_LIMIT_DELAY_MS = 5000
MAX_BACKOFF_SECONDS = 300
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
)
BASE_URL = "https://www.freewebnovel.com"


def search_novels(query: str, page: int = 1, session: Optional[requests.Session] = None) -> List[Dict[str, Any]]:
    """
    Search for novels by name on freewebnovel.com.
    
    Args:
        query: Search query string
        page: Page number (default 1)
        session: Optional requests.Session for connection pooling
    
    Returns:
        List of dicts with keys: url, title, author, cover, genre
    """
    if not session:
        session = requests.Session()
        session.headers.update({"User-Agent": DEFAULT_USER_AGENT})
    
    url = f"{BASE_URL}/search?keywords={query}&pageNo={page}"
    
    try:
        response = session.get(url, timeout=10)
        response.raise_for_status()
    except requests.RequestException as e:
        print(json.dumps({"type": "error", "code": "NETWORK_ERROR", "message": str(e), "retryable": True}), file=sys.stdout)
        return []
    
    soup = BeautifulSoup(response.content, "html.parser")
    results = []
    
    # Try multiple selectors for search results
    search_items = soup.select("div.SearchResult") or soup.select("div.novel-item") or []
    
    for item in search_items[:50]:  # Max 50 results
        try:
            title_elem = item.select_one("a.novel-title")
            title = title_elem.get_text(strip=True) if title_elem else "Unknown"
            
            url_elem = title_elem if title_elem and title_elem.get("href") else None
            novel_url = urljoin(BASE_URL, url_elem.get("href", "")) if url_elem else ""
            
            author_elem = item.select_one("span.author-name")
            author = author_elem.get_text(strip=True) if author_elem else "Unknown"
            
            cover_elem = item.select_one("img.cover-image")
            cover = cover_elem.get("src", "") if cover_elem else ""
            cover = urljoin(BASE_URL, cover) if cover and not cover.startswith("http") else cover
            
            genre_elem = item.select_one("a.genre")
            genre = genre_elem.get_text(strip=True) if genre_elem else ""
            
            if novel_url and title:
                results.append({
                    "url": novel_url,
                    "title": title,
                    "author": author,
                    "cover": cover,
                    "genre": genre,
                })
        except Exception:
            # Skip malformed results
            continue
    
    return results


def extract_metadata(soup: BeautifulSoup, novel_url: str) -> Dict[str, Any]:
    """
    Extract novel metadata from a BeautifulSoup object.
    
    Args:
        soup: BeautifulSoup object of the novel page
        novel_url: URL of the novel
    
    Returns:
        Dict with keys: title, author, description, cover_url, genre, status
    """
    metadata = {
        "title": "Unknown",
        "author": "Unknown",
        "description": "",
        "cover_url": "",
        "genre": "",
        "status": "ongoing",
    }
    
    # Try Open Graph meta tags first
    og_title = soup.select_one('meta[property="og:title"]')
    if og_title:
        metadata["title"] = og_title.get("content", "Unknown")
    
    og_image = soup.select_one('meta[property="og:image"]')
    if og_image:
        metadata["cover_url"] = og_image.get("content", "")
    
    og_desc = soup.select_one('meta[property="og:description"]')
    if og_desc:
        metadata["description"] = og_desc.get("content", "")
    
    # Fallback to HTML parsing if meta tags not found
    if metadata["title"] == "Unknown":
        title_elem = soup.select_one("h1.novel-title") or soup.select_one(".book-name")
        if title_elem:
            metadata["title"] = title_elem.get_text(strip=True)
    
    author_elem = soup.select_one(".author-name") or soup.select_one("span.author")
    if author_elem:
        metadata["author"] = author_elem.get_text(strip=True)
    
    desc_elem = soup.select_one(".description") or soup.select_one("p.summary")
    if desc_elem:
        metadata["description"] = desc_elem.get_text(strip=True)
    
    status_elem = soup.select_one(".novel-status") or soup.select_one("span.status")
    if status_elem:
        status_text = status_elem.get_text(strip=True).lower()
        metadata["status"] = "completed" if "completed" in status_text else "ongoing"
    
    return metadata


def clean_chapter_content(raw_html: str) -> str:
    """
    Clean chapter content: remove ads, scripts, styles, author notes, etc.
    
    Args:
        raw_html: Raw HTML content
    
    Returns:
        Cleaned HTML string
    """
    soup = BeautifulSoup(raw_html, "html.parser")
    
    # Remove script, style, noscript tags completely
    for tag in soup.find_all(["script", "style", "noscript"]):
        tag.decompose()
    
    # Remove elements with ad/banner/comment/author-note class or id patterns
    patterns = ["ad", "banner", "comment", "author-note", "advertisement"]
    for pattern in patterns:
        # Remove by class
        for elem in soup.find_all(class_=re.compile(pattern, re.IGNORECASE)):
            elem.decompose()
        # Remove by id
        for elem in soup.find_all(id=re.compile(pattern, re.IGNORECASE)):
            elem.decompose()
    
    # Remove event handler attributes
    for tag in soup.find_all(True):
        for attr in ["onclick", "onload", "onerror", "onmouseover", "onmouseout"]:
            if tag.has_attr(attr):
                del tag[attr]
    
    # Convert relative img src to absolute
    for img in soup.find_all("img"):
        if img.has_attr("src"):
            src = img["src"]
            if not src.startswith("http"):
                img["src"] = urljoin(BASE_URL, src)
    
    # Remove external links but keep chapter links
    for link in soup.find_all("a"):
        if link.has_attr("href"):
            href = link["href"]
            # Remove if external (not freewebnovel) and not a path-style link
            if not any(domain in href for domain in ["freewebnovel.com", "/"]) and href.startswith("http"):
                # Unwrap: replace link with its text
                link.unwrap()
    
    # Trim excessive whitespace
    for tag in soup.find_all(string=re.compile(r"\n\s*\n")):
        tag.replace_with(tag.strip())
    
    return str(soup.get_text(strip=False))


def find_next_chapter_url(soup: BeautifulSoup, current_url: str) -> Optional[str]:
    """
    Find next chapter URL using fallback selector chain.
    
    Args:
        soup: BeautifulSoup object of chapter page
        current_url: Current chapter URL (for relative URL resolution)
    
    Returns:
        Next chapter URL or None if not found (novel complete)
    """
    # Selector fallback chain
    selectors = [
        "a.next",
        "a[rel='next']",
        "a.btn-next",
        "a.next-page",
    ]
    
    for selector in selectors:
        elem = soup.select_one(selector)
        if elem and elem.get("href"):
            return urljoin(BASE_URL, elem["href"])
    
    # Try regex pattern matching for chapter links
    all_links = soup.find_all("a", href=re.compile(r"/chapter-\d+", re.IGNORECASE))
    if all_links:
        return urljoin(BASE_URL, all_links[-1]["href"])
    
    # Try text matching "Next Chapter"
    for link in soup.find_all("a"):
        if "next" in link.get_text(strip=True).lower():
            if link.get("href"):
                return urljoin(BASE_URL, link["href"])
    
    return None


def save_chapter(cache_dir: str, chapter_num: int, chapter_data: Dict[str, Any]) -> bool:
    """
    Save chapter to disk using atomic write pattern.
    
    Args:
        cache_dir: Directory to save chapter data
        chapter_num: Chapter number
        chapter_data: Dict with keys: chapter_number, chapter_title, url, content, word_count
    
    Returns:
        True if successful, False otherwise
    """
    try:
        chapters_dir = Path(cache_dir) / "chapters"
        chapters_dir.mkdir(parents=True, exist_ok=True)
        
        # Prepare chapter data with completion flag
        chapter_json = {
            "chapter_number": chapter_num,
            "chapter_title": chapter_data.get("chapter_title", ""),
            "url": chapter_data.get("url", ""),
            "content": chapter_data.get("content", ""),
            "word_count": chapter_data.get("word_count", 0),
            "scraped_at": datetime.utcnow().isoformat() + "Z",
            "completed": False,
        }
        
        # Atomic write: temp file -> fsync -> rename
        temp_file = chapters_dir / f"{chapter_num}.json.tmp"
        final_file = chapters_dir / f"{chapter_num}.json"
        
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(chapter_json, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        
        # Atomic rename
        temp_file.replace(final_file)
        
        # Update state
        update_state_json(cache_dir, {
            "last_chapter_scraped": chapter_num,
            "last_chapter_valid": True,
        })
        
        return True
    except Exception as e:
        print(json.dumps({
            "type": "error",
            "code": "WRITE_ERROR",
            "message": f"Failed to save chapter {chapter_num}: {str(e)}",
            "retryable": False,
        }), file=sys.stdout)
        return False


def update_state_json(cache_dir: str, updates: Dict[str, Any]) -> bool:
    """
    Update state.json with atomic write pattern.
    
    Args:
        cache_dir: Cache directory containing state.json
        updates: Dict of updates to merge
    
    Returns:
        True if successful, False otherwise
    """
    try:
        state_file = Path(cache_dir) / "state.json"
        
        # Load existing state or initialize
        state = {}
        if state_file.exists():
            with open(state_file, "r", encoding="utf-8") as f:
                state = json.load(f)
        
        # Merge updates
        state.update(updates)
        state["updated_at"] = datetime.utcnow().isoformat() + "Z"
        
        # Atomic write
        temp_file = state_file.parent / "state.json.tmp"
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        
        temp_file.replace(state_file)
        return True
    except Exception:
        return False


def scrape_chapter(
    session: requests.Session,
    chapter_url: str,
    cache_dir: str,
    chapter_num: int,
) -> Optional[Dict[str, Any]]:
    """
    Scrape a single chapter from URL.
    
    Args:
        session: Requests session
        chapter_url: Full chapter URL
        cache_dir: Cache directory
        chapter_num: Chapter number for logging
    
    Returns:
        Dict with chapter data or None on error
    """
    try:
        response = session.get(chapter_url, timeout=15)
        response.raise_for_status()
    except requests.RequestException as e:
        print(json.dumps({
            "type": "error",
            "code": "NETWORK_ERROR",
            "message": str(e),
            "retryable": True,
            "chapter": chapter_num,
        }), file=sys.stdout)
        return None
    
    soup = BeautifulSoup(response.content, "html.parser")
    
    # Extract chapter title
    title_elem = soup.select_one("h1.chapter-title") or soup.select_one(".chapter-name")
    chapter_title = title_elem.get_text(strip=True) if title_elem else f"Chapter {chapter_num}"
    
    # Extract chapter content
    content_elem = soup.select_one("div.chapter-content") or soup.select_one(".content")
    if not content_elem:
        print(json.dumps({
            "type": "error",
            "code": "PARSE_ERROR",
            "message": "Could not find chapter content element",
            "retryable": False,
            "chapter": chapter_num,
        }), file=sys.stderr)
        return None
    
    raw_html = str(content_elem)
    content = clean_chapter_content(raw_html)
    word_count = len(content.split())
    
    # Find next chapter URL
    next_url = find_next_chapter_url(soup, chapter_url)
    
    return {
        "chapter_number": chapter_num,
        "chapter_title": chapter_title,
        "url": chapter_url,
        "content": content,
        "word_count": word_count,
        "next_url": next_url,
    }


def scrape_novel(
    novel_id: str,
    start_chapter: int,
    cache_dir: str,
    rate_limit_delay_ms: int = DEFAULT_RATE_LIMIT_DELAY_MS,
) -> int:
    """
    Main scrape loop for a novel.
    
    Args:
        novel_id: Novel identifier
        start_chapter: Chapter number to start from
        cache_dir: Cache directory for output
        rate_limit_delay_ms: Delay between requests in milliseconds
    
    Returns:
        Exit code (0 for success, 1 for error)
    """
    session = requests.Session()
    session.headers.update({"User-Agent": DEFAULT_USER_AGENT})
    
    # Create cache directory
    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    
    current_chapter = start_chapter
    backoff_delay = 2  # Start with 2^1 = 2 seconds
    consecutive_errors = 0
    
    while True:
        try:
            # Get current chapter URL (would come from a data source in production)
            # For now, we construct it based on a pattern
            chapter_url = f"{BASE_URL}/novel/{novel_id}/chapter-{current_chapter}"
            
            # Attempt to scrape chapter
            chapter_data = scrape_chapter(session, chapter_url, cache_dir, current_chapter)
            
            if chapter_data is None:
                consecutive_errors += 1
                if consecutive_errors >= 3:
                    print(json.dumps({
                        "type": "error",
                        "code": "MAX_RETRIES_EXCEEDED",
                        "message": "Failed to scrape after 3 attempts",
                        "retryable": False,
                        "chapter": current_chapter,
                    }), file=sys.stdout)
                    return 1
                time.sleep(rate_limit_delay_ms / 1000.0)
                continue
            
            consecutive_errors = 0
            
            # Save chapter atomically
            if not save_chapter(cache_dir, current_chapter, chapter_data):
                print(json.dumps({
                    "type": "error",
                    "code": "WRITE_ERROR",
                    "message": f"Failed to save chapter {current_chapter}",
                    "retryable": False,
                    "chapter": current_chapter,
                }), file=sys.stdout)
                return 1
            
            # Output progress
            print(json.dumps({
                "type": "chapter_complete",
                "chapter": current_chapter,
                "title": chapter_data.get("chapter_title"),
                "wordCount": chapter_data.get("word_count", 0),
            }), file=sys.stdout)
            
            # Check if there's a next chapter
            if not chapter_data.get("next_url"):
                print(json.dumps({
                    "type": "complete",
                    "chapter": current_chapter,
                    "totalChapters": current_chapter,
                }), file=sys.stdout)
                return 0
            
            # Rate limit
            time.sleep(rate_limit_delay_ms / 1000.0)
            current_chapter += 1
            backoff_delay = 2  # Reset backoff
            
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 429:
                # Rate limited - exponential backoff
                backoff = min(backoff_delay, MAX_BACKOFF_SECONDS // 2)
                print(json.dumps({
                    "type": "rate_limited",
                    "backoff_seconds": backoff,
                    "chapter": current_chapter,
                }), file=sys.stdout)
                time.sleep(backoff)
                backoff_delay *= 2
                continue
            else:
                print(json.dumps({
                    "type": "error",
                    "code": "HTTP_ERROR",
                    "message": f"HTTP {e.response.status_code}",
                    "retryable": True,
                    "chapter": current_chapter,
                }), file=sys.stdout)
                return 1


def main():
    """Command-line interface."""
    parser = argparse.ArgumentParser(
        description="Scraper for freewebnovel.com using Beautiful Soup"
    )
    
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")
    
    # Search command
    search_parser = subparsers.add_parser("search", help="Search for novels")
    search_parser.add_argument("--query", required=True, help="Search query")
    search_parser.add_argument("--page", type=int, default=1, help="Page number (default 1)")
    
    # Scrape command
    scrape_parser = subparsers.add_parser("scrape", help="Scrape a novel")
    scrape_parser.add_argument("--novel-id", required=True, help="Novel ID")
    scrape_parser.add_argument("--start-chapter", type=int, default=1, help="Starting chapter (default 1)")
    scrape_parser.add_argument("--cache-dir", required=True, help="Cache directory for output")
    scrape_parser.add_argument(
        "--rate-limit-delay-ms",
        type=int,
        default=DEFAULT_RATE_LIMIT_DELAY_MS,
        help=f"Delay between requests in ms (default {DEFAULT_RATE_LIMIT_DELAY_MS})",
    )
    
    args = parser.parse_args()
    
    if args.command == "search":
        session = requests.Session()
        session.headers.update({"User-Agent": DEFAULT_USER_AGENT})
        results = search_novels(args.query, args.page, session)
        print(json.dumps(results, ensure_ascii=False, indent=2), file=sys.stdout)
        return 0
    
    elif args.command == "scrape":
        return scrape_novel(
            args.novel_id,
            args.start_chapter,
            args.cache_dir,
            args.rate_limit_delay_ms,
        )
    
    else:
        parser.print_help()
        return 1


if __name__ == "__main__":
    sys.exit(main())
