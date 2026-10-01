# Local hooks (optional)

Enable the identity-enforcing pre-commit hook:

```bash
git config core.hooksPath .githooks
```

Allowed identity only:

- name: `visify-apps`
- email: `visifyapps@gmail.com`

GitHub Action `.github/workflows/enforce-commit-identity.yml` fails pushes/PRs whose commits use any other author or committer.
