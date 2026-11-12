"""Keep the frontend version workflow's publication boundary explicit.

These source contracts complement Actionlint; they do not replace YAML syntax
validation. The publisher behavior is exercised separately with a fake API.
"""

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


def steps(workflow):
    """Split the fixed workflow's named steps without interpreting YAML values."""
    return re.split(r"(?m)^      - name: ", workflow)[1:]


class DevVersionWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = ROOT.joinpath(".github/workflows/dev-version.yml").read_text()
        cls.ci = ROOT.joinpath(".github/workflows/ci.yml").read_text()
        cls.release = ROOT.joinpath(".github/workflows/release-please.yml").read_text()

    def test_events_and_release_filter_preserve_the_selected_policy(self):
        self.assertIn("  push:\n    branches: [dev]", self.workflow)
        self.assertIn("  release:\n    types: [published]", self.workflow)
        self.assertIn("      dry_run:\n", self.workflow)
        self.assertIn("        type: boolean\n        default: false", self.workflow)
        for condition in (
            "github.event_name != 'release'",
            "github.event.release.draft == false",
            "github.event.release.prerelease == false",
        ):
            self.assertIn(condition, self.workflow)
        self.assertIn("  cancel-in-progress: false", self.workflow)

    def test_read_only_calculation_is_pinned_to_checked_out_source_and_main(self):
        self.assertIn("permissions:\n  contents: read\n  pull-requests: read", self.workflow)
        self.assertIn("ref: ${{ github.event_name == 'push' && github.sha || 'dev' }}", self.workflow)
        self.assertIn("fetch-depth: 0", self.workflow)
        self.assertIn("fetch-tags: true", self.workflow)
        self.assertIn("persist-credentials: false", self.workflow)
        self.assertIn("git fetch --no-tags origin main:refs/remotes/origin/main", self.workflow)
        self.assertIn("SOURCE_SHA=$(git rev-parse HEAD)", self.workflow)
        self.assertIn('--head "$SOURCE_SHA"', self.workflow)
        self.assertIn('GH_TOKEN: ${{ github.token }}', self.workflow)
        self.assertNotIn("origin/master", self.workflow)

    def test_only_guarded_publication_receives_the_write_token(self):
        publish = [step for step in steps(self.workflow) if "--publish" in step]
        self.assertEqual(len(publish), 1)
        self.assertIn("github.event_name != 'workflow_dispatch' || inputs.dry_run != true", publish[0])
        self.assertIn("DEV_VERSION_TOKEN: ${{ secrets.RELEASE_PLEASE_TOKEN }}", publish[0])
        for step in steps(self.workflow):
            if step != publish[0]:
                self.assertNotIn("secrets.", step)
        self.assertEqual(self.workflow.count("secrets.RELEASE_PLEASE_TOKEN"), 1)
        self.assertIn("token: ${{ secrets.RELEASE_PLEASE_TOKEN }}", self.release)
        self.assertNotRegex(self.workflow, r"(?m)^env:")

    def test_publication_runs_after_the_actual_calculator_and_publisher_tests(self):
        tokens = [
            "npm ci --prefix scripts/dev-version --ignore-scripts",
            "npm test --prefix scripts/dev-version",
            'python3 -B -m unittest discover -s tests -p "test_dev_version_*.py" -q',
            "node scripts/dev-version/calculate.mjs",
            "--publish --github-output",
        ]
        positions = [self.workflow.index(token) for token in tokens]
        self.assertEqual(positions, sorted(positions))
        for token in tokens[:3]:
            self.assertIn(token, self.ci)
        self.assertIn("npm audit --prefix scripts/dev-version --audit-level=moderate", self.ci)

    def test_sync_never_adds_images_releases_force_updates_or_fixed_identity(self):
        self.assertNotRegex(self.workflow, r"\b(?:docker|podman)\s+(?:build|push)\b")
        self.assertNotRegex(self.workflow, r"\bgh\s+(?:release|workflow)\b")
        self.assertNotRegex(self.workflow, r"git\s+(?:push|checkout|switch|reset)\b")
        self.assertNotRegex(self.workflow, r"--force\b|--author\b|user\.name|user\.email")
        self.assertNotRegex(self.workflow, r"\[skip ci\]|\[ci skip\]")
        self.assertIn("No image, tag or release is created.", self.workflow)


if __name__ == "__main__":
    unittest.main()
