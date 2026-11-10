// ==========================================================================
// Quandle GitHub Action · src/index.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Entry point. One call: run main against the real runtime. No logic at all, and
// nothing here can throw: @actions/core and Octokit do no work at import, the
// event is read later inside main's try (ERR-3), and Octokit is only built when
// a run asks for the GitHub API.
// ==========================================================================
import { readFileSync } from 'node:fs';
import * as core from '@actions/core';
import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import type { OctokitApi } from './io/github';
import { quandle_main_run_action } from './main';
import { quandle_runtime_build_actionRuntime } from './io/runtime';

const PaginatingOctokit = Octokit.plugin(paginateRest);

void quandle_main_run_action(
  quandle_runtime_build_actionRuntime(
    core,
    {
      env: process.env,
      readFile: (path) => readFileSync(path, 'utf8'),
      fetch: (url, init) => fetch(url, init),
    },
    (options): OctokitApi => {
      const octokit = new PaginatingOctokit(options);
      return {
        request: (route, parameters) => octokit.request(route, parameters),
        // Octokit types paginate per route with heavy generics; at runtime it is exactly OctokitApi.paginate.
        paginate: (route, parameters, mapPage) =>
          (octokit.paginate as unknown as OctokitApi['paginate'])(route, parameters, mapPage),
      };
    },
  ),
);
