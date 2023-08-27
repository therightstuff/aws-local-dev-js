"use strict"

// build-layers copies layers/src folder contents into layer/build, then runs
// the npm install and prune commands

const fs = require("fs");
const fse = require("fs-extra");
const path = require("path");
const spawn = require("child_process");
const { checksumDirectory } = require("simple-recursive-checksum");
const { getPersistentShell } = require("./persistent-shell");

const LAYER_SRC_PATH = path.resolve('layers/src');
const LAYER_BUILD_PATH = path.resolve('layers/build');

function getValidSubDirectories(path) {
    return fs.readdirSync(path, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
}

async function processLayer(layer) {
    console.log(`processing layer ${layer}...`);

    let layerSrcPath = path.join(LAYER_SRC_PATH, layer);

    const packageJsonExists = fs.existsSync(path.join(layerSrcPath, 'package.json'));
    const setupPyExists = fs.existsSync(path.join(layerSrcPath ,'setup.py'));
    const requirementsTxtExists = fs.existsSync(path.join(layerSrcPath, 'requirements.txt'));

    const isNodeJsLayer = packageJsonExists;
    const isPythonLayer = setupPyExists || requirementsTxtExists;
    if (!isNodeJsLayer && !isPythonLayer) {
        console.log(`unable to identify supported runtime for layer ${layer}, skipping...`);
        return;
    }
    let layerBuildPath = path.join(LAYER_BUILD_PATH, layer);

    let hash = await checksumDirectory(layerSrcPath, 'md5');

    // if the hash matches the hash in the build directory, skip this layer
    let buildHashFile = `${layerBuildPath}.md5`;
    let buildHash = fs.existsSync(buildHashFile) ?
        fs.readFileSync(buildHashFile, { encoding: 'utf8' }).trim()
        : null;

    if (hash == buildHash) {
        console.log(`skipping ${layer}, no changes detected...\n`);
    } else {
        // delete the build hash file if it exists
        if (buildHash) {
            fs.unlinkSync(buildHashFile);
        }

        console.log(`(re)creating build directory...`);
        fs.rmSync(layerBuildPath, { recursive: true, force: true });

        // if the layer has npm package files, we have a node.js layer
        if (packageJsonExists) {
            let nodeJsContentsPath = path.join(layerBuildPath, 'nodejs');
            fs.mkdirSync(nodeJsContentsPath, { recursive: true });
            // copy everything except the package-lock file and node_modules
            let srcContents = fs.readdirSync(layerSrcPath, { withFileTypes: true })
                .filter(dirent => {
                    return !(
                        dirent.name == "node_modules" ||
                        dirent.name == "package-lock.json"
                    )
                })
                .map(dirent => dirent.name)
            for (let file of srcContents) {
                fse.copySync(
                    path.join(layerSrcPath, file),
                    path.join(nodeJsContentsPath, file)
                );
            }

            console.log("installing npm dependencies...");
            spawn.execSync('npm install --force', { cwd: nodeJsContentsPath });
            console.log("pruning unused npm modules...");
            spawn.execSync('npm prune', { cwd: nodeJsContentsPath });

            console.log("removing package-lock.json...");
            fs.unlinkSync(path.join(nodeJsContentsPath, 'package-lock.json'));
        }

        // if the layer has a setup.py or requirements.txt file, we have a python layer
        if (setupPyExists || requirementsTxtExists) {
            let pythonContentsPath = path.join(layerBuildPath, 'python');
            fs.mkdirSync(pythonContentsPath, { recursive: true });

            console.log("recreating virtual environment...");
            let shell = getPersistentShell();
            shell.execCmd(`cd ${layerSrcPath}`);
            shell.execCmd(`python3 -m venv venv`);
            const activateScript = process.platform === "win32" ?
                path.join("venv","Scripts","activate.bat")
                : ". venv/bin/activate";
            shell.execCmd(activateScript);

            // install dependencies
            shell.execCmd(`python3 -m pip install --upgrade pip`);
            if (setupPyExists) {
                fse.copySync(
                    path.join(layerSrcPath, "setup.py"),
                    path.join(pythonContentsPath, "setup.py")
                );
                shell.execCmd(`python3 -m pip install --target ${pythonContentsPath} --upgrade .`);
            }
            if (requirementsTxtExists) {
                fse.copySync(
                    path.join(layerSrcPath, "requirements.txt"),
                    path.join(pythonContentsPath, "requirements.txt")
                );
                shell.execCmd(`python3 -m pip install --target ${pythonContentsPath} --upgrade -r requirements.txt`);
            }

            shell.execCmd(`exit`);
            // uncomment the following to debug:
            // console.log(await shell.finalResult);

            // remove virtual environment to preserve original hash
            console.log("removing virtual environment from source path...");
            fs.rmSync(path.join(layerSrcPath, "venv"), { recursive: true, force: true });
        }

        console.log(`writing hash to ${buildHashFile}...`);
        fs.writeFileSync(buildHashFile, hash, { encoding: 'utf8' });

        console.log(`${layer} folder build complete\n`);
    }
}

async function processLayers() {
    const srcDirs = getValidSubDirectories(LAYER_SRC_PATH);

    for (let layer of srcDirs) {
        await processLayer(layer);
    }
}

async function removeObsoleteBuildDirectories() {
    const srcDirs = getValidSubDirectories(LAYER_SRC_PATH);
    const buildDirs = getValidSubDirectories(LAYER_BUILD_PATH);

    console.log(`deleting previous build directories that don't have matching source directories...\n`);
    for (const buildDir of buildDirs) {
        if (!srcDirs.includes(buildDir)) {
            console.log(`deleting ${buildDir}...`);
            const layerBuildPath = path.join(LAYER_BUILD_PATH, buildDir);
            fs.rmSync(layerBuildPath, { recursive: true, force: true });
            const buildHashFile = `${layerBuildPath}.md5`;
            if (fs.existsSync(buildHashFile)) {
                fs.unlinkSync(buildHashFile);
            }
        }
    }
}

async function main() {
    console.log('building layers...\n')

    // ensure layers directories exist
    fs.mkdirSync(LAYER_SRC_PATH, {recursive: true});
    fs.mkdirSync(LAYER_BUILD_PATH, {recursive: true});

    await removeObsoleteBuildDirectories();

    await processLayers();
}

main().then(()=>{
    console.log('layer builds completed.\n');
});
