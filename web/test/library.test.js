import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shelf-library-'));
const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'shelf-outside-'));
process.env.DOWNLOADS_DIR = root;

const { scanLibrary, resolveLibraryFile } = await import('../server/library.js');

async function write(relative, content) {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  return target;
}

await write('epub/Test Book.epub', 'epub-bytes');
await write('pdf/Test Book.pdf', 'pdf-bytes');
await write('epub/Only EPUB.epub', 'epub-only');
await write('courses/course-1234567890/Chapter 1/Intro.mp4', 'video-bytes');
await write('courses/course-1234567890/Chapter 1/Intro.txt', 'transcript-bytes');
await write('.hidden/secret.epub', 'hidden');
await fs.writeFile(path.join(outside, 'outside.txt'), 'outside');
await fs.symlink(path.join(outside, 'outside.txt'), path.join(root, 'escape.txt'));

test.after(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

test('scanLibrary finds books, courses, and ignores hidden files', async () => {
  const library = await scanLibrary(root);
  assert.equal(library.books.length, 2);
  assert.equal(library.courses.length, 1);
  const book = library.books.find((entry) => entry.title === 'Test Book');
  assert.deepEqual(
    book.formats.map((format) => format.format).sort(),
    ['epub', 'pdf'],
  );
  assert.equal(book.sizeBytes, 19);
  const course = library.courses[0];
  assert.equal(course.courseId, '1234567890');
  assert.equal(course.fileCount, 2);
  assert.equal(course.videoCount, 1);
  assert.equal(course.transcriptCount, 1);
});

test('resolveLibraryFile accepts files inside the downloads directory', async () => {
  const resolved = await resolveLibraryFile('epub/Test Book.epub', root);
  assert.equal(resolved.relativePath, 'epub/Test Book.epub');
  assert.equal(resolved.stat.size, 10);
});

test('resolveLibraryFile rejects traversal and malformed paths', async () => {
  await assert.rejects(() => resolveLibraryFile('../cookies.json', root), {
    status: 400,
  });
  await assert.rejects(() => resolveLibraryFile('/etc/passwd', root), {
    status: 400,
  });
  await assert.rejects(() => resolveLibraryFile('epub\\..\\secret', root), {
    status: 400,
  });
  await assert.rejects(() => resolveLibraryFile('', root), { status: 400 });
});

test('resolveLibraryFile rejects symlinks that escape the library', async () => {
  await assert.rejects(() => resolveLibraryFile('escape.txt', root), {
    status: 403,
  });
});

test('resolveLibraryFile returns 404 for missing files', async () => {
  await assert.rejects(() => resolveLibraryFile('missing.epub', root), {
    status: 404,
  });
});
