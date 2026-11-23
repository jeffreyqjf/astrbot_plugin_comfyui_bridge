import re
import unittest

from bridge.studio.remote_studio import ASSETS, VIEW


class WorkbenchAssetTests(unittest.TestCase):
    def test_all_relative_module_imports_have_remote_routes(self):
        for asset in ASSETS:
            path = VIEW / asset
            self.assertTrue(path.is_file(), asset)
            if path.suffix not in {".js", ".mjs"}:
                continue
            imports = re.findall(r'''(?:from\s*|import\s*\(\s*|import\s*)["']\./([^"']+)["']''', path.read_text(encoding="utf-8"))
            for dependency in imports:
                dependency = dependency.split("?", 1)[0].split("#", 1)[0]
                self.assertIn(dependency, ASSETS, f"{asset} imports {dependency}, but the remote route is missing")
