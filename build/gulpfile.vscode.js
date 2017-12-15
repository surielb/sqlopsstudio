/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const path = require('path');
const es = require('event-stream');
const azure = require('gulp-azure-storage');
const electron = require('gulp-atom-electron');
const vfs = require('vinyl-fs');
const rename = require('gulp-rename');
const replace = require('gulp-replace');
const filter = require('gulp-filter');
const buffer = require('gulp-buffer');
const json = require('gulp-json-editor');
const _ = require('underscore');
const util = require('./lib/util');
const ext = require('./lib/extensions');
const buildfile = require('../src/buildfile');
const common = require('./lib/optimize');
const nlsDev = require('vscode-nls-dev');
const root = path.dirname(__dirname);
const commit = util.getVersion(root);
const packageJson = require('../package.json');
const product = require('../product.json');
const shrinkwrap = require('../npm-shrinkwrap.json');
const crypto = require('crypto');
const i18n = require('./lib/i18n');
var del = require('del');

// {{SQL CARBON EDIT}}
const serviceInstaller = require('extensions-modules/lib/languageservice/serviceInstallerUtil');
const glob = require('glob');

const productDependencies = Object.keys(product.dependencies || {});
const dependencies = Object.keys(shrinkwrap.dependencies)
	.concat(productDependencies); // additional dependencies from our product configuration
const baseModules = Object.keys(process.binding('natives')).filter(n => !/^_|\//.test(n));
// {{SQL CARBON EDIT}}
const nodeModules = [
	'electron',
	'original-fs',
	'rxjs/Observable',
	'rxjs/Subject',
	'rxjs/Observer',
	'ng2-charts/ng2-charts']
	.concat(dependencies)
	.concat(baseModules);

// Build

const builtInExtensions = [
	{ name: 'ms-vscode.node-debug', version: '1.18.3' },
	{ name: 'ms-vscode.node-debug2', version: '1.18.5' }
];

const excludedExtensions = [
	'vscode-api-tests',
	'vscode-colorize-tests'
];

const vscodeEntryPoints = _.flatten([
	buildfile.entrypoint('vs/workbench/workbench.main'),
	buildfile.base,
	buildfile.workbench,
	buildfile.code
]);

const vscodeResources = [
	'out-build/main.js',
	'out-build/cli.js',
	'out-build/bootstrap.js',
	'out-build/bootstrap-amd.js',
	'out-build/paths.js',
	'out-build/vs/**/*.{svg,png,cur,html}',
	'out-build/vs/base/node/startupTimers.js',
	'out-build/vs/base/node/{stdForkStart.js,terminateProcess.sh}',
	'out-build/vs/base/browser/ui/octiconLabel/octicons/**',
	'out-build/vs/workbench/browser/media/*-theme.css',
	'out-build/vs/workbench/electron-browser/bootstrap/**',
	'out-build/vs/workbench/parts/debug/**/*.json',
	'out-build/vs/workbench/parts/execution/**/*.scpt',
	'out-build/vs/workbench/parts/html/browser/webview-pre.js',
	'out-build/vs/**/markdown.css',
	'out-build/vs/workbench/parts/tasks/**/*.json',
	'out-build/vs/workbench/parts/terminal/electron-browser/terminalProcess.js',
	'out-build/vs/workbench/parts/welcome/walkThrough/**/*.md',
	'out-build/vs/workbench/services/files/**/*.exe',
	'out-build/vs/workbench/services/files/**/*.md',
	'out-build/vs/code/electron-browser/sharedProcess.js',
  // {{SQL CARBON EDIT}}
	'out-build/sql/workbench/electron-browser/splashscreen/*',
	'out-build/sql/**/*.{svg,png,cur,html}',
	'out-build/sql/base/browser/ui/table/media/*.{gif,png,svg}',
	'out-build/sql/base/browser/ui/checkbox/media/*.{gif,png,svg}',
	'out-build/sql/parts/admin/**/*.html',
	'out-build/sql/parts/connection/connectionDialog/media/*.{gif,png,svg}',
	'out-build/sql/parts/common/dblist/**/*.html',
	'out-build/sql/parts/dashboard/**/*.html',
	'out-build/sql/parts/disasterRecovery/**/*.html',
	'out-build/sql/parts/common/modal/media/**',
	'out-build/sql/parts/grid/load/lib/**',
	'out-build/sql/parts/grid/load/loadJquery.js',
	'out-build/sql/parts/grid/media/**',
	'out-build/sql/parts/grid/views/**/*.html',
	'out-build/sql/parts/tasks/**/*.html',
	'out-build/sql/parts/taskHistory/viewlet/media/**',
	'out-build/sql/media/objectTypes/*.svg',
	'out-build/sql/media/icons/*.svg',
	'!**/test/**'
];

const BUNDLED_FILE_HEADER = [
	'/*!--------------------------------------------------------',
	' * Copyright (C) Microsoft Corporation. All rights reserved.',
	' *--------------------------------------------------------*/'
].join('\n');

var languages = ['chs', 'cht', 'jpn', 'kor', 'deu', 'fra', 'esn', 'rus', 'ita'];
if (process.env.VSCODE_QUALITY !== 'stable') {
	languages = languages.concat(['ptb', 'hun', 'trk']); // Add languages requested by the community to non-stable builds
}

gulp.task('clean-optimized-vscode', util.rimraf('out-vscode'));
gulp.task('optimize-vscode', ['clean-optimized-vscode', 'compile-build', 'compile-extensions-build'], common.optimizeTask({
	entryPoints: vscodeEntryPoints,
	otherSources: [],
	resources: vscodeResources,
	loaderConfig: common.loaderConfig(nodeModules),
	header: BUNDLED_FILE_HEADER,
	out: 'out-vscode',
	languages: languages
}));


gulp.task('optimize-index-js', ['optimize-vscode'], () => {
	const fullpath = path.join(process.cwd(), 'out-vscode/vs/workbench/electron-browser/bootstrap/index.js');
	const contents = fs.readFileSync(fullpath).toString();
	const newContents = contents.replace('[/*BUILD->INSERT_NODE_MODULES*/]', JSON.stringify(nodeModules));
	fs.writeFileSync(fullpath, newContents);
});

const baseUrl = `https://ticino.blob.core.windows.net/sourcemaps/${commit}/core`;
gulp.task('clean-minified-vscode', util.rimraf('out-vscode-min'));
gulp.task('minify-vscode', ['clean-minified-vscode', 'optimize-index-js'], common.minifyTask('out-vscode', baseUrl));

// Package
const darwinCreditsTemplate = product.darwinCredits && _.template(fs.readFileSync(path.join(root, product.darwinCredits), 'utf8'));

const config = {
	version: packageJson.electronVersion,
	productAppName: product.nameLong,
	companyName: 'Microsoft Corporation',
	copyright: 'Copyright (C) 2017 Microsoft. All rights reserved',
	darwinIcon: 'resources/darwin/code.icns',
	darwinBundleIdentifier: product.darwinBundleIdentifier,
	darwinApplicationCategoryType: 'public.app-category.developer-tools',
	darwinHelpBookFolder: 'VS Code HelpBook',
	darwinHelpBookName: 'VS Code HelpBook',
	darwinBundleDocumentTypes: [{
		name: product.nameLong + ' document',
		role: 'Editor',
		ostypes: ["TEXT", "utxt", "TUTX", "****"],
		  // {{SQL CARBON EDIT}}
		extensions: ["csv", "json", "sqlplan", "sql", "xml"],
		iconFile: 'resources/darwin/code_file.icns'
	}],
	darwinBundleURLTypes: [{
		role: 'Viewer',
		name: product.nameLong,
		urlSchemes: [product.urlProtocol]
	}],
	darwinCredits: darwinCreditsTemplate ? new Buffer(darwinCreditsTemplate({ commit: commit, date: new Date().toISOString() })) : void 0,
	linuxExecutableName: product.applicationName,
	winIcon: 'resources/win32/code.ico',
	token: process.env['VSCODE_MIXIN_PASSWORD'] || process.env['GITHUB_TOKEN'] || void 0,
	repo: product.electronRepository || void 0
};

function getElectron(arch) {
	return () => {
		const electronOpts = _.extend({}, config, {
			platform: process.platform,
			arch,
			ffmpegChromium: true,
			keepDefaultApp: true
		});

		return gulp.src('package.json')
			.pipe(json({ name: product.nameShort }))
			.pipe(electron(electronOpts))
			.pipe(filter(['**', '!**/app/package.json']))
			.pipe(vfs.dest('.build/electron'));
	};
}

gulp.task('clean-electron', util.rimraf('.build/electron'));
gulp.task('electron', ['clean-electron'], getElectron(process.arch));
gulp.task('electron-ia32', ['clean-electron'], getElectron('ia32'));
gulp.task('electron-x64', ['clean-electron'], getElectron('x64'));


/**
 * Compute checksums for some files.
 *
 * @param {string} out The out folder to read the file from.
 * @param {string[]} filenames The paths to compute a checksum for.
 * @return {Object} A map of paths to checksums.
 */
function computeChecksums(out, filenames) {
	var result = {};
	filenames.forEach(function (filename) {
		var fullPath = path.join(process.cwd(), out, filename);
		result[filename] = computeChecksum(fullPath);
	});
	return result;
}

/**
 * Compute checksum for a file.
 *
 * @param {string} filename The absolute path to a filename.
 * @return {string} The checksum for `filename`.
 */
function computeChecksum(filename) {
	var contents = fs.readFileSync(filename);

	var hash = crypto
		.createHash('md5')
		.update(contents)
		.digest('base64')
		.replace(/=+$/, '');

	return hash;
}

function packageTask(platform, arch, opts) {
	opts = opts || {};

  // {{SQL CARBON EDIT}}
	const destination = path.join(path.dirname(root), 'sqlops') + (platform ? '-' + platform : '') + (arch ? '-' + arch : '');
	platform = platform || process.platform;

	return () => {
		const out = opts.minified ? 'out-vscode-min' : 'out-vscode';

		const checksums = computeChecksums(out, [
			'vs/workbench/workbench.main.js',
			'vs/workbench/workbench.main.css',
			'vs/workbench/electron-browser/bootstrap/index.html',
			'vs/workbench/electron-browser/bootstrap/index.js',
			'vs/workbench/electron-browser/bootstrap/preload.js'
		]);

		const src = gulp.src(out + '/**', { base: '.' })
			.pipe(rename(function (path) { path.dirname = path.dirname.replace(new RegExp('^' + out), 'out'); }));

		const root = path.resolve(path.join(__dirname, '..'));
		const localExtensionDescriptions = glob.sync('extensions/*/package.json')
			.map(manifestPath => {
				const extensionPath = path.dirname(path.join(root, manifestPath));
				const extensionName = path.basename(extensionPath);
				return { name: extensionName, path: extensionPath };
			})
			.filter(({ name }) => excludedExtensions.indexOf(name) === -1)
			.filter(({ name }) => builtInExtensions.every(b => b.name !== name));

		const localExtensions = es.merge(...localExtensionDescriptions.map(extension => {
			const nlsFilter = filter('**/*.nls.json', { restore: true });

			return ext.fromLocal(extension.path)
				.pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`))
				// 	// TODO@Dirk: this filter / buffer is here to make sure the nls.json files are buffered
				.pipe(nlsFilter)
				.pipe(buffer())
				.pipe(nlsDev.createAdditionalLanguageFiles(languages, path.join(__dirname, '..', 'i18n')))
				.pipe(nlsFilter.restore);
		}));

		const localExtensionDependencies = gulp.src('extensions/node_modules/**', { base: '.' });

		// {{SQL CARBON EDIT}}
		const sources = es.merge(src, localExtensions, localExtensionDependencies)
			.pipe(util.setExecutableBit(['**/*.sh']))
			.pipe(filter(['**',
						  '!**/*.js.map',
						  '!extensions/**/node_modules/**/{test, tests}/**',
						  '!extensions/**/node_modules/**/test.js']));

		let version = packageJson.version;
		const quality = product.quality;

		if (quality && quality !== 'stable') {
			version += '-' + quality;
		}

		const name = product.nameShort;
		const packageJsonStream = gulp.src(['package.json'], { base: '.' })
			.pipe(json({ name, version }));

		const settingsSearchBuildId = getBuildNumber();
		const date = new Date().toISOString();
		const productJsonStream = gulp.src(['product.json'], { base: '.' })
			.pipe(json({ commit, date, checksums, settingsSearchBuildId }));

		const license = gulp.src(['LICENSES.chromium.html', 'LICENSE.txt', 'ThirdPartyNotices.txt', 'licenses/**'], { base: '.' });

		const watermark = gulp.src(['resources/letterpress.svg', 'resources/letterpress-dark.svg', 'resources/letterpress-hc.svg'], { base: '.' });

		// TODO the API should be copied to `out` during compile, not here
		const api = gulp.src('src/vs/vscode.d.ts').pipe(rename('out/vs/vscode.d.ts'));
		// {{SQL CARBON EDIT}}
    	const dataApi = gulp.src('src/vs/data.d.ts').pipe(rename('out/sql/data.d.ts'));

		const depsSrc = _.flatten(dependencies
			.map(function (d) { return ['node_modules/' + d + '/**', '!node_modules/' + d + '/**/{test,tests}/**']; }));

		const deps = gulp.src(depsSrc, { base: '.', dot: true })
			.pipe(filter(['**', '!**/package-lock.json']))
			.pipe(util.cleanNodeModule('fsevents', ['binding.gyp', 'fsevents.cc', 'build/**', 'src/**', 'test/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('oniguruma', ['binding.gyp', 'build/**', 'src/**', 'deps/**'], ['**/*.node', 'src/*.js']))
			.pipe(util.cleanNodeModule('windows-mutex', ['binding.gyp', 'build/**', 'src/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('native-keymap', ['binding.gyp', 'build/**', 'src/**', 'deps/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('native-watchdog', ['binding.gyp', 'build/**', 'src/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('jschardet', ['dist/**']))
			.pipe(util.cleanNodeModule('windows-foreground-love', ['binding.gyp', 'build/**', 'src/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('windows-process-tree', ['binding.gyp', 'build/**', 'src/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('gc-signals', ['binding.gyp', 'build/**', 'src/**', 'deps/**'], ['**/*.node', 'src/index.js']))
			.pipe(util.cleanNodeModule('v8-profiler', ['binding.gyp', 'build/**', 'src/**', 'deps/**'], ['**/*.node', 'src/index.js']))
			.pipe(util.cleanNodeModule('keytar', ['binding.gyp', 'build/**', 'src/**', 'script/**', 'node_modules/**'], ['**/*.node']))
			.pipe(util.cleanNodeModule('node-pty', ['binding.gyp', 'build/**', 'src/**', 'tools/**'], ['build/Release/**']))
			.pipe(util.cleanNodeModule('nsfw', ['binding.gyp', 'build/**', 'src/**', 'openpa/**', 'includes/**'], ['**/*.node', '**/*.a']))
			.pipe(util.cleanNodeModule('vsda', ['binding.gyp', 'README.md', 'build/**', '*.bat', '*.sh', '*.cpp', '*.h'], ['build/Release/vsda.node']));

		let all = es.merge(
			packageJsonStream,
			productJsonStream,
			license,
			watermark,
			api,
      // {{SQL CARBON EDIT}}
			dataApi,
			sources,
			deps
		);

		if (platform === 'win32') {
			all = es.merge(all, gulp.src(['resources/win32/code_file.ico', 'resources/win32/code_70x70.png', 'resources/win32/code_150x150.png'], { base: '.' }));
		} else if (platform === 'linux') {
			all = es.merge(all, gulp.src('resources/linux/code.png', { base: '.' }));
		} else if (platform === 'darwin') {
			const shortcut = gulp.src('resources/darwin/bin/code.sh')
				.pipe(rename('bin/code'));

			all = es.merge(all, shortcut);
		}

		let result = all
			.pipe(util.skipDirectories())
			.pipe(util.fixWin32DirectoryPermissions())
			.pipe(electron(_.extend({}, config, { platform, arch, ffmpegChromium: true })))
			.pipe(filter(['**', '!LICENSE', '!LICENSES.chromium.html', '!version']));

		if (platform === 'win32') {
			result = es.merge(result, gulp.src('resources/win32/bin/code.js', { base: 'resources/win32' }));

			result = es.merge(result, gulp.src('resources/win32/bin/code.cmd', { base: 'resources/win32' })
				.pipe(replace('@@NAME@@', product.nameShort))
				.pipe(rename(function (f) { f.basename = product.applicationName; })));

			result = es.merge(result, gulp.src('resources/win32/bin/code.sh', { base: 'resources/win32' })
				.pipe(replace('@@NAME@@', product.nameShort))
				.pipe(rename(function (f) { f.basename = product.applicationName; f.extname = ''; })));

			result = es.merge(result, gulp.src('resources/win32/VisualElementsManifest.xml', { base: 'resources/win32' })
				.pipe(rename(product.nameShort + '.VisualElementsManifest.xml')));
		} else if (platform === 'linux') {
			result = es.merge(result, gulp.src('resources/linux/bin/code.sh', { base: '.' })
				.pipe(replace('@@NAME@@', product.applicationName))
				.pipe(rename('bin/' + product.applicationName)));
		}

		return result.pipe(vfs.dest(destination));
	};
}

const buildRoot = path.dirname(root);

// {{SQL CARBON EDIT}}
gulp.task('clean-vscode-win32-ia32', util.rimraf(path.join(buildRoot, 'sqlops-win32-ia32')));
gulp.task('clean-vscode-win32-x64', util.rimraf(path.join(buildRoot, 'sqlops-win32-x64')));
gulp.task('clean-vscode-darwin', util.rimraf(path.join(buildRoot, 'sqlops-darwin')));
gulp.task('clean-vscode-linux-ia32', util.rimraf(path.join(buildRoot, 'sqlops-linux-ia32')));
gulp.task('clean-vscode-linux-x64', util.rimraf(path.join(buildRoot, 'sqlops-linux-x64')));
gulp.task('clean-vscode-linux-arm', util.rimraf(path.join(buildRoot, 'sqlops-linux-arm')));

gulp.task('vscode-win32-ia32', ['optimize-vscode', 'clean-vscode-win32-ia32'], packageTask('win32', 'ia32'));
gulp.task('vscode-win32-x64', ['optimize-vscode', 'clean-vscode-win32-x64'], packageTask('win32', 'x64'));
gulp.task('vscode-darwin', ['optimize-vscode', 'clean-vscode-darwin'], packageTask('darwin'));
gulp.task('vscode-linux-ia32', ['optimize-vscode', 'clean-vscode-linux-ia32'], packageTask('linux', 'ia32'));
gulp.task('vscode-linux-x64', ['optimize-vscode', 'clean-vscode-linux-x64'], packageTask('linux', 'x64'));
gulp.task('vscode-linux-arm', ['optimize-vscode', 'clean-vscode-linux-arm'], packageTask('linux', 'arm'));

gulp.task('vscode-win32-ia32-min', ['minify-vscode', 'clean-vscode-win32-ia32'], packageTask('win32', 'ia32', { minified: true }));
gulp.task('vscode-win32-x64-min', ['minify-vscode', 'clean-vscode-win32-x64'], packageTask('win32', 'x64', { minified: true }));
gulp.task('vscode-darwin-min', ['minify-vscode', 'clean-vscode-darwin'], packageTask('darwin', null, { minified: true }));
gulp.task('vscode-linux-ia32-min', ['minify-vscode', 'clean-vscode-linux-ia32'], packageTask('linux', 'ia32', { minified: true }));
gulp.task('vscode-linux-x64-min', ['minify-vscode', 'clean-vscode-linux-x64'], packageTask('linux', 'x64', { minified: true }));
gulp.task('vscode-linux-arm-min', ['minify-vscode', 'clean-vscode-linux-arm'], packageTask('linux', 'arm', { minified: true }));

// Transifex Localizations
const vscodeLanguages = [
	'zh-hans',
	'zh-hant',
	'ja',
	'ko',
	'de',
	'fr',
	'es',
	'ru',
	'it',
	'pt-br',
	'hu',
	'tr'
];
const setupDefaultLanguages = [
	'zh-hans',
	'zh-hant',
	'ko'
];

const apiHostname = process.env.TRANSIFEX_API_URL;
const apiName = process.env.TRANSIFEX_API_NAME;
const apiToken = process.env.TRANSIFEX_API_TOKEN;

gulp.task('vscode-translations-push', ['optimize-vscode'], function () {
	const pathToMetadata = './out-vscode/nls.metadata.json';
	const pathToExtensions = './extensions/**/*.nls.json';
	const pathToSetup = 'build/win32/**/{Default.isl,messages.en.isl}';

	return es.merge(
		gulp.src(pathToMetadata).pipe(i18n.prepareXlfFiles()),
		gulp.src(pathToSetup).pipe(i18n.prepareXlfFiles()),
		gulp.src(pathToExtensions).pipe(i18n.prepareXlfFiles('vscode-extensions'))
	).pipe(i18n.pushXlfFiles(apiHostname, apiName, apiToken));
});

gulp.task('vscode-translations-pull', function () {
	return es.merge(
		i18n.pullXlfFiles('vscode-editor', apiHostname, apiName, apiToken, vscodeLanguages),
		i18n.pullXlfFiles('vscode-workbench', apiHostname, apiName, apiToken, vscodeLanguages),
		i18n.pullXlfFiles('vscode-extensions', apiHostname, apiName, apiToken, vscodeLanguages),
		i18n.pullXlfFiles('vscode-setup', apiHostname, apiName, apiToken, setupDefaultLanguages)
	).pipe(vfs.dest('../vscode-localization'));
});

gulp.task('vscode-translations-import', function () {
	return gulp.src('../vscode-localization/**/*.xlf').pipe(i18n.prepareJsonFiles()).pipe(vfs.dest('./i18n'));
});

// Sourcemaps

gulp.task('upload-vscode-sourcemaps', ['minify-vscode'], () => {
	const vs = gulp.src('out-vscode-min/**/*.map', { base: 'out-vscode-min' })
		.pipe(es.mapSync(f => {
			f.path = `${f.base}/core/${f.relative}`;
			return f;
		}));

	const extensions = gulp.src('extensions/**/out/**/*.map', { base: '.' });

	return es.merge(vs, extensions)
		.pipe(azure.upload({
			account: process.env.AZURE_STORAGE_ACCOUNT,
			key: process.env.AZURE_STORAGE_ACCESS_KEY,
			container: 'sourcemaps',
			prefix: commit + '/'
		}));
});

const allConfigDetailsPath = path.join(os.tmpdir(), 'configuration.json');
gulp.task('upload-vscode-configuration', ['generate-vscode-configuration'], () => {
	const branch = process.env.BUILD_SOURCEBRANCH;
	if (!branch.endsWith('/master') && !branch.indexOf('/release/') >= 0) {
		console.log(`Only runs on master and release branches, not ${branch}`);
		return;
	}

	if (!fs.existsSync(allConfigDetailsPath)) {
		console.error(`configuration file at ${allConfigDetailsPath} does not exist`);
		return;
	}

	const settingsSearchBuildId = getBuildNumber();
	if (!settingsSearchBuildId) {
		console.error('Failed to compute build number');
		return;
	}

	return gulp.src(allConfigDetailsPath)
		.pipe(azure.upload({
			account: process.env.AZURE_STORAGE_ACCOUNT,
			key: process.env.AZURE_STORAGE_ACCESS_KEY,
			container: 'configuration',
			prefix: `${settingsSearchBuildId}/${commit}/`
		}));
});

function getBuildNumber() {
	const previous = getPreviousVersion(packageJson.version);
	if (!previous) {
		return 0;
	}

	try {
		const out = cp.execSync(`git rev-list ${previous}..HEAD --count`);
		const count = parseInt(out.toString());
		return versionStringToNumber(packageJson.version) * 1e4 + count;
	} catch (e) {
		console.error('Could not determine build number: ' + e.toString());
		return 0;
	}
}

/**
 * Given 1.17.2, return 1.17.1
 * 1.18.0 => 1.17.2.
 * 2.0.0 => 1.18.0 (or the highest 1.x)
 */
function getPreviousVersion(versionStr) {
	function tagExists(tagName) {
		try {
			cp.execSync(`git rev-parse ${tagName}`, { stdio: 'ignore' });
			return true;
		} catch (e) {
			return false;
		}
	}

	function getLastTagFromBase(semverArr, componentToTest) {
		const baseVersion = semverArr.join('.');
		if (!tagExists(baseVersion)) {
			console.error('Failed to find tag for base version, ' + baseVersion);
			return null;
		}

		let goodTag;
		do {
			goodTag = semverArr.join('.');
			semverArr[componentToTest]++;
		} while (tagExists(semverArr.join('.')));

		return goodTag;
	}

	const semverArr = versionStr.split('.');
	if (semverArr[2] > 0) {
		semverArr[2]--;
		return semverArr.join('.');
	} else if (semverArr[1] > 0) {
		semverArr[1]--;
		return getLastTagFromBase(semverArr, 2);
	} else {
		semverArr[0]--;
		return getLastTagFromBase(semverArr, 1);
	}
}

function versionStringToNumber(versionStr) {
	const semverRegex = /(\d+)\.(\d+)\.(\d+)/;
	const match = versionStr.match(semverRegex);
	if (!match) {
		return 0;
	}

	return parseInt(match[1], 10) * 1e4 + parseInt(match[2], 10) * 1e2 + parseInt(match[3], 10);
}

gulp.task('generate-vscode-configuration', () => {
	return new Promise((resolve, reject) => {
		const buildDir = process.env['AGENT_BUILDDIRECTORY'];
		if (!buildDir) {
			return reject(new Error('$AGENT_BUILDDIRECTORY not set'));
		}

		const userDataDir = path.join(os.tmpdir(), 'tmpuserdata');
		const extensionsDir = path.join(os.tmpdir(), 'tmpextdir');
		const appPath = path.join(buildDir, 'VSCode-darwin/Visual\\ Studio\\ Code\\ -\\ Insiders.app/Contents/Resources/app/bin/code');
		const codeProc = cp.exec(`${appPath} --export-default-configuration='${allConfigDetailsPath}' --wait --user-data-dir='${userDataDir}' --extensions-dir='${extensionsDir}'`);

		const timer = setTimeout(() => {
			codeProc.kill();
			reject(new Error('export-default-configuration process timed out'));
		}, 10 * 1000);

		codeProc.stdout.on('data', d => console.log(d.toString()));
		codeProc.stderr.on('data', d => console.log(d.toString()));

		codeProc.on('exit', () => {
			clearTimeout(timer);
			resolve();
		});

		codeProc.on('error', err => {
			clearTimeout(timer);
			reject(err);
		});
	}).catch(e => {
		// Don't fail the build
		console.error(e.toString());
	});
});

// {{SQL CARBON EDIT}}
// Install service locally before building carbon

function installService(extObj) {
	var installer = new serviceInstaller.ServiceInstaller(extObj, true);
	installer.getServiceInstallDirectoryRoot().then(serviceInstallFolder => {
			console.log('Cleaning up the install folder: ' + serviceInstallFolder);
			del(serviceInstallFolder + '/*').then(() => {
				console.log('Installing the service. Install folder: ' + serviceInstallFolder);
				installer.installService();
			}, delError => {
				console.log('failed to delete the install folder error: ' + delError);
			});
	}, getFolderPathError => {
		console.log('failed to call getServiceInstallDirectoryRoot error: ' + getFolderPathError);
	});

}

gulp.task('install-sqltoolsservice', () => {
	var mssqlExt = require('../extensions/mssql/client/out/models/constants');
	var extObj = new mssqlExt.Constants();
    return installService(extObj);
});

