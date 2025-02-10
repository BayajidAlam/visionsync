const fs = require('fs');
const path = require('path');

// Step 2: Get module name from command line arguments
const moduleName = process.argv[2];
if (!moduleName) {
  console.error('Please provide a module name.');
  process.exit(1);
}

// Step 3: Define file names and optionally their default contents
const files = [
  'route.ts',
  'controller.ts',
  'service.ts',
  'interface.ts',
  'validation.ts',
  'constant.ts',
  'model.ts',
  'utils.ts',
];

// Step 4: Create module directory if it doesn't exist
const modulePath = path.join(__dirname, 'src', 'app', 'modules', moduleName);
if (!fs.existsSync(modulePath)) {
  fs.mkdirSync(modulePath, { recursive: true });
}

// Step 5: Create files with default content
files.forEach(file => {
  const filePath = path.join(modulePath, `${moduleName}.${file}`);
  const content = `// ${moduleName} ${file.split('.')[0]}\n`;
  fs.writeFile(filePath, content, (err) => {
    if (err) {
      console.error(`Error creating ${filePath}: ${err}`);
    } else {
      console.log(`Created ${filePath}`);
    }
  });
});
