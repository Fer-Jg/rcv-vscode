import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';
import { AutoRenderScheduler, isCvYamlFile } from '../utils/autoRender';
import { findNewestPdf } from '../utils/rcv';
import {
	getRootKeyScalarValue,
	parseYamlFile,
	preflightYamlSplitFiles,
	predictRenderCvSourceFileName,
	setRootKeyScalarValue,
	splitRootKeysToFiles,
	writeRootKeysFromFiles,
	type SplitRootDestination,
} from '../utils/yamlDocuments';
import {
	getCvFolderLayout,
	getGlobalConfigFiles,
	getWorkspaceLayout,
} from '../utils/workspaceLayout';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Predicts RenderCV source file name from person name', () => {
		assert.strictEqual(predictRenderCvSourceFileName('Given Name'), 'Given_Name_CV.yaml');
		assert.strictEqual(predictRenderCvSourceFileName('  Given   Middle Name  '), 'Given_Middle_Name_CV.yaml');
	});

	test('Resolves structured workspace paths', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-layout-'));
		try {
			const workspaceFolder = makeWorkspaceFolder(dir);
			const layout = getWorkspaceLayout(workspaceFolder);
			const cvLayout = getCvFolderLayout(workspaceFolder, 'Given Name');
			const globals = getGlobalConfigFiles(layout);

			assertPathEqual(layout.globalsFolder, path.join(dir, 'globals'));
			assertPathEqual(layout.yamlRoot, path.join(dir, 'yamls'));
			assertPathEqual(layout.outputsRoot, path.join(dir, 'outputs'));
			assertPathEqual(cvLayout.cvYamlFolder, path.join(dir, 'yamls', 'Given_Name'));
			assertPathEqual(cvLayout.cvFile, path.join(dir, 'yamls', 'Given_Name', 'cv.yaml'));
			assertPathEqual(cvLayout.outputFolder, path.join(dir, 'outputs', 'Given_Name'));
			assertPathEqual(globals.design, path.join(dir, 'globals', 'design.yaml'));
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Preflight detects generated source and fixed destination conflicts', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-yaml-preflight-'));
		try {
			const sourcePath = path.join(dir, 'Given_Name_CV.yaml');
			const destinations = makeDestinations(dir);
			await fs.promises.writeFile(sourcePath, '', 'utf8');
			await fs.promises.writeFile(path.join(dir, 'design.yaml'), '', 'utf8');

			const result = await preflightYamlSplitFiles(sourcePath, destinations);

			assert.strictEqual(result.sourceFilePath, sourcePath);
			assert.deepStrictEqual(
				result.conflicts.sort(),
				[
					sourcePath,
					path.join(dir, 'design.yaml'),
				].sort()
			);
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Splits root keys into fixed files, copies schema, preserves comments, and deletes source', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-yaml-split-'));
		try {
			const sourcePath = path.join(dir, 'Given_Name_CV.yaml');
			await writeSampleYaml(sourcePath);

			const result = await splitRootKeysToFiles(sourcePath, makeDestinations(dir));

			assert.deepStrictEqual(result.removedKeys, ['cv', 'design', 'locale', 'settings']);
			assert.strictEqual(result.createdFiles.length, 4);
			assert.strictEqual(result.deletedSourceFile, true);

			const cvSplit = await fs.promises.readFile(path.join(dir, 'cv.yaml'), 'utf8');
			assert.match(cvSplit, /# yaml-language-server: \$schema=https:\/\/example\.com\/schema\.json/);
			assert.ok(cvSplit.indexOf('# yaml-language-server: $schema=') < cvSplit.indexOf('cv:'));
			assert.strictEqual(countHeaderSchemaComments(cvSplit), 1);
			assert.match(cvSplit, /\$schema: https:\/\/example\.com\/schema\.json/);
			assert.match(cvSplit, /# CV comment/);
			assert.match(cvSplit, /cv:/);

			const designSplit = await fs.promises.readFile(path.join(dir, 'design.yaml'), 'utf8');
			assert.match(designSplit, /# yaml-language-server: \$schema=https:\/\/example\.com\/schema\.json/);
			assert.ok(designSplit.indexOf('# yaml-language-server: $schema=') < designSplit.indexOf('design:'));
			assert.match(designSplit, /# Design comment/);
			assert.match(designSplit, /design:/);

			await assert.rejects(() => fs.promises.stat(sourcePath), /ENOENT/);
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Discards non-local config roots while still deleting source', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-yaml-discard-'));
		try {
			const sourcePath = path.join(dir, 'Given_Name_CV.yaml');
			await writeSampleYaml(sourcePath);

			const result = await splitRootKeysToFiles(sourcePath, [
				{ rootKey: 'cv', localFile: path.join(dir, 'cv.yaml') },
				{ rootKey: 'design' },
				{ rootKey: 'locale' },
				{ rootKey: 'settings' },
			]);

			assert.deepStrictEqual(result.removedKeys, ['cv', 'design', 'locale', 'settings']);
			assert.deepStrictEqual(await fs.promises.readdir(dir), ['cv.yaml']);
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Copies selected config roots to globals without overwriting', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-yaml-global-'));
		try {
			const sourcePath = path.join(dir, 'Given_Name_CV.yaml');
			const globalsDir = path.join(dir, 'globals');
			await fs.promises.mkdir(globalsDir);
			await writeSampleYaml(sourcePath);

			const result = await splitRootKeysToFiles(sourcePath, [
				{ rootKey: 'cv', localFile: path.join(dir, 'cv.yaml') },
				{
					rootKey: 'design',
					localFile: path.join(dir, 'design.yaml'),
					globalFile: path.join(globalsDir, 'design.yaml'),
				},
			]);

			assert.strictEqual(result.createdFiles.length, 3);
			const globalDesign = await fs.promises.readFile(path.join(globalsDir, 'design.yaml'), 'utf8');
			assert.match(globalDesign, /# yaml-language-server: \$schema=https:\/\/example\.com\/schema\.json/);
			assert.match(globalDesign, /design:/);
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Copies RenderCV header schema comment to local and global split files', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-yaml-header-schema-'));
		try {
			const sourcePath = path.join(dir, 'Given_Name_CV.yaml');
			const globalsDir = path.join(dir, 'globals');
			await fs.promises.mkdir(globalsDir);
			await writeRenderCvStyleYaml(sourcePath);

			await splitRootKeysToFiles(sourcePath, [
				{ rootKey: 'cv', localFile: path.join(dir, 'cv.yaml') },
				{
					rootKey: 'design',
					localFile: path.join(dir, 'design.yaml'),
					globalFile: path.join(globalsDir, 'design.yaml'),
				},
				{
					rootKey: 'locale',
					localFile: path.join(dir, 'locale.yaml'),
					globalFile: path.join(globalsDir, 'locale.yaml'),
				},
				{
					rootKey: 'settings',
					localFile: path.join(dir, 'settings.yaml'),
					globalFile: path.join(globalsDir, 'settings.yaml'),
				},
			]);

			for (const filePath of [
				path.join(dir, 'cv.yaml'),
				path.join(dir, 'design.yaml'),
				path.join(dir, 'locale.yaml'),
				path.join(dir, 'settings.yaml'),
				path.join(globalsDir, 'design.yaml'),
				path.join(globalsDir, 'locale.yaml'),
				path.join(globalsDir, 'settings.yaml'),
			]) {
				const contents = await fs.promises.readFile(filePath, 'utf8');
				assert.match(contents, /# yaml-language-server: \$schema=https:\/\/example\.com\/rendercv-schema\.json/);
				assert.strictEqual(countHeaderSchemaComments(contents), 1);
			}
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Split refuses to overwrite existing destination files', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-yaml-collision-'));
		try {
			const sourcePath = path.join(dir, 'Given_Name_CV.yaml');
			await writeSampleYaml(sourcePath);
			await fs.promises.writeFile(path.join(dir, 'design.yaml'), 'existing', 'utf8');

			await assert.rejects(
				() => splitRootKeysToFiles(sourcePath, makeDestinations(dir)),
				/Cannot split YAML because these files already exist/
			);

			assert.strictEqual(await fs.promises.readFile(path.join(dir, 'design.yaml'), 'utf8'), 'existing');
			assert.match(await fs.promises.readFile(sourcePath, 'utf8'), /^cv:/m);
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Split fails before writing when YAML has parse errors', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-yaml-error-'));
		try {
			const sourcePath = path.join(dir, 'Given_Name_CV.yaml');
			await fs.promises.writeFile(sourcePath, 'cv: [unterminated\n', 'utf8');

			await assert.rejects(
				() => splitRootKeysToFiles(sourcePath, makeDestinations(dir)),
				/Failed to parse YAML file/
			);
			assert.strictEqual((await fs.promises.readdir(dir)).length, 1);
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Clones root keys from existing files without mutating the source', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-yaml-clone-'));
		try {
			const sourceDir = path.join(dir, 'source');
			const targetDir = path.join(dir, 'target');
			await fs.promises.mkdir(sourceDir);
			await fs.promises.mkdir(targetDir);
			const sourceCv = path.join(sourceDir, 'cv.yaml');
			const sourceDesign = path.join(sourceDir, 'design.yaml');
			await fs.promises.writeFile(sourceCv, [
				'# yaml-language-server: $schema=https://example.com/rendercv-schema.json',
				'cv:',
				'  name: Original Person',
				'  email: original@example.com',
				'',
			].join('\n'), 'utf8');
			await fs.promises.writeFile(sourceDesign, [
				'# yaml-language-server: $schema=https://example.com/rendercv-schema.json',
				'design:',
				'  theme: classic',
				'',
			].join('\n'), 'utf8');
			const originalCvContents = await fs.promises.readFile(sourceCv, 'utf8');

			const result = await writeRootKeysFromFiles([
				{
					rootKey: 'cv',
					sourceFile: sourceCv,
					localFile: path.join(targetDir, 'cv.yaml'),
					mutate: (_pair, document) => setRootKeyScalarValue(document, 'cv', ['name'], 'Original Person'),
				},
				{
					rootKey: 'design',
					sourceFile: sourceDesign,
					localFile: path.join(targetDir, 'design.yaml'),
					mutate: (_pair, document) => setRootKeyScalarValue(document, 'design', ['theme'], 'moderncv'),
				},
			]);

			assert.strictEqual(result.createdFiles.length, 2);
			assert.strictEqual(result.deletedSourceFile, false);
			assert.strictEqual(await fs.promises.readFile(sourceCv, 'utf8'), originalCvContents);
			const clonedCv = await fs.promises.readFile(path.join(targetDir, 'cv.yaml'), 'utf8');
			const clonedDesign = await fs.promises.readFile(path.join(targetDir, 'design.yaml'), 'utf8');
			assert.match(clonedCv, /name: Original Person/);
			assert.match(clonedCv, /email: original@example\.com/);
			assert.match(clonedDesign, /theme: moderncv/);
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Clones global fallback config into selected local output', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-yaml-clone-global-'));
		try {
			const globalsDir = path.join(dir, 'globals');
			const targetDir = path.join(dir, 'target');
			await fs.promises.mkdir(globalsDir);
			await fs.promises.mkdir(targetDir);
			const globalLocale = path.join(globalsDir, 'locale.yaml');
			await fs.promises.writeFile(globalLocale, [
				'locale:',
				'  language: english',
				'  last_updated: Last updated in',
				'',
			].join('\n'), 'utf8');

			await writeRootKeysFromFiles([
				{
					rootKey: 'locale',
					sourceFile: globalLocale,
					localFile: path.join(targetDir, 'locale.yaml'),
					mutate: (_pair, document) => setRootKeyScalarValue(document, 'locale', ['language'], 'spanish'),
				},
			]);

			const clonedLocale = await parseYamlFile(path.join(targetDir, 'locale.yaml'));
			assert.strictEqual(getRootKeyScalarValue(clonedLocale, 'locale', ['language']), 'spanish');
			assert.strictEqual(getRootKeyScalarValue(clonedLocale, 'locale', ['last_updated']), 'Last updated in');
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Clone writing refuses destination conflicts', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-yaml-clone-conflict-'));
		try {
			const sourceCv = path.join(dir, 'source.yaml');
			const targetCv = path.join(dir, 'cv.yaml');
			await fs.promises.writeFile(sourceCv, 'cv:\n  name: Person\n', 'utf8');
			await fs.promises.writeFile(targetCv, 'existing', 'utf8');

			await assert.rejects(
				() => writeRootKeysFromFiles([
					{ rootKey: 'cv', sourceFile: sourceCv, localFile: targetCv },
				]),
				/Cannot write YAML because these files already exist/
			);

			assert.strictEqual(await fs.promises.readFile(targetCv, 'utf8'), 'existing');
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Finds newest PDF in an output folder', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-pdf-newest-'));
		try {
			const olderPdf = path.join(dir, 'old.pdf');
			const newerPdf = path.join(dir, 'new.pdf');
			await fs.promises.writeFile(olderPdf, '', 'utf8');
			await fs.promises.writeFile(newerPdf, '', 'utf8');

			const now = new Date();
			await fs.promises.utimes(olderPdf, new Date(now.getTime() - 10000), new Date(now.getTime() - 10000));
			await fs.promises.utimes(newerPdf, now, now);

			assert.strictEqual(await findNewestPdf(dir), newerPdf);
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Returns no PDF for missing or empty output folders', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rendercv-pdf-empty-'));
		try {
			assert.strictEqual(await findNewestPdf(dir), undefined);
			assert.strictEqual(await findNewestPdf(path.join(dir, 'missing')), undefined);
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	test('Identifies only cv.yaml and cv.yml as auto-render CV files', () => {
		assert.strictEqual(isCvYamlFile(path.join('folder', 'cv.yaml')), true);
		assert.strictEqual(isCvYamlFile(path.join('folder', 'CV.YML')), true);
		assert.strictEqual(isCvYamlFile(path.join('folder', 'design.yaml')), false);
		assert.strictEqual(isCvYamlFile(path.join('folder', 'settings.yaml')), false);
		assert.strictEqual(isCvYamlFile(path.join('folder', 'my-cv.yaml')), false);
	});

	test('Auto-render scheduler coalesces rapid changes into one render', async () => {
		const timers = new ManualTimers();
		const rendered: string[] = [];
		const scheduler = new AutoRenderScheduler({
			render: async filePath => {
				rendered.push(filePath);
			},
			setTimer: timers.setTimer,
			clearTimer: timers.clearTimer,
		});

		scheduler.schedule('cv.yaml', 123);
		scheduler.schedule('cv.yaml', 123);
		assert.deepStrictEqual(timers.delays, [123, 123]);

		timers.runAll();
		await flushPromises();

		assert.deepStrictEqual(rendered, ['cv.yaml']);
		scheduler.dispose();
	});

	test('Auto-render scheduler queues one follow-up render while rendering', async () => {
		const timers = new ManualTimers();
		const firstRender = createDeferred<void>();
		let renderCount = 0;
		const scheduler = new AutoRenderScheduler({
			render: async () => {
				renderCount += 1;
				if (renderCount === 1) {
					await firstRender.promise;
				}
			},
			setTimer: timers.setTimer,
			clearTimer: timers.clearTimer,
		});

		scheduler.schedule('cv.yaml', 0);
		timers.runAll();
		await flushPromises();

		scheduler.schedule('cv.yaml', 0);
		scheduler.schedule('cv.yaml', 0);
		timers.runAll();
		await flushPromises();
		assert.strictEqual(renderCount, 1);

		firstRender.resolve();
		await flushPromises();
		await flushPromises();

		assert.strictEqual(renderCount, 2);
		scheduler.dispose();
	});
});

function makeWorkspaceFolder(folder: string): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(folder),
		name: path.basename(folder),
		index: 0,
	};
}

function makeDestinations(folder: string): SplitRootDestination[] {
	return [
		{ rootKey: 'cv', localFile: path.join(folder, 'cv.yaml') },
		{ rootKey: 'design', localFile: path.join(folder, 'design.yaml') },
		{ rootKey: 'locale', localFile: path.join(folder, 'locale.yaml') },
		{ rootKey: 'settings', localFile: path.join(folder, 'settings.yaml') },
	];
}

async function writeSampleYaml(sourcePath: string): Promise<void> {
	await fs.promises.writeFile(sourcePath, [
		'# yaml-language-server: $schema=https://example.com/schema.json',
		'$schema: https://example.com/schema.json',
		'',
		'# CV comment',
		'cv:',
		'  name: Given Name',
		'',
		'# Design comment',
		'design:',
		'  theme: classic',
		'',
		'# Locale comment',
		'locale:',
		'  language: en',
		'',
		'# Settings comment',
		'settings:',
		'  output: pdf',
		'',
		'# Unexpected comment',
		'extra:',
		'  value: true',
		'',
	].join('\n'), 'utf8');
}

async function writeRenderCvStyleYaml(sourcePath: string): Promise<void> {
	await fs.promises.writeFile(sourcePath, [
		'# yaml-language-server: $schema=https://example.com/rendercv-schema.json',
		'cv:',
		'  name: Given Name',
		'design:',
		'  theme: classic',
		'locale:',
		'  language: english',
		'settings:',
		'  output: pdf',
		'',
	].join('\n'), 'utf8');
}

function assertPathEqual(actual: string, expected: string): void {
	if (process.platform === 'win32') {
		assert.strictEqual(actual.toLowerCase(), expected.toLowerCase());
		return;
	}

	assert.strictEqual(actual, expected);
}

function countHeaderSchemaComments(value: string): number {
	return value.split(/\r?\n/).filter(line => line.startsWith('# yaml-language-server: $schema=')).length;
}

class ManualTimers {
	public readonly delays: number[] = [];
	private readonly callbacks = new Map<ReturnType<typeof setTimeout>, () => void>();
	private nextId = 0;

	public readonly setTimer = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
		const timer = { id: this.nextId++ } as unknown as ReturnType<typeof setTimeout>;
		this.delays.push(delayMs);
		this.callbacks.set(timer, callback);
		return timer;
	};

	public readonly clearTimer = (timer: ReturnType<typeof setTimeout>): void => {
		this.callbacks.delete(timer);
	};

	public runAll(): void {
		const callbacks = [...this.callbacks.values()];
		this.callbacks.clear();
		for (const callback of callbacks) {
			callback();
		}
	}
}

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
	await new Promise(resolve => setImmediate(resolve));
}
