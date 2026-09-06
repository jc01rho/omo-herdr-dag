# OmO Herdr DAG

**OmO workflow DAG를 Herdr 옆 pane에서 실시간으로 확인하세요.**

[English](README.md) | 한국어

`omo-herdr-dag`는 workflow DAG가 생성되면 [Herdr](https://herdr.dev/)에 전용 TUI를 여는 [OmO](https://github.com/code-yeongyu/oh-my-openagent) 확장입니다. 대화 옆에서 노드 상태와 의존 관계를 확인할 수 있으며, 포커스는 기존 pane에 유지합니다.

![왼쪽 OmO에서 저녁 메뉴 조사 workflow를 실행하고, 오른쪽 Herdr DAG pane에서 실행 중인 조사 노드 세 개와 대기 중인 검증 노드를 확인하는 화면.](https://raw.githubusercontent.com/jc01rho/omo-herdr-dag/main/docs/screenshots/workflow-in-progress.png)

*실행 중인 workflow 예시입니다. `home`, `order`, `light`가 저녁 메뉴 후보를 병렬로 조사하고, 세 작업에 의존하는 `verify`는 대기합니다. 왼쪽에서 대화를 이어가면서 오른쪽 pane에서 각 작업의 상태와 전체 의존 관계를 확인할 수 있습니다.*

스크린샷은 이전 버전의 한국어 화면입니다. 새 설치의 기본 언어는 **영어**이며 `--lang ko`로 한국어를 선택할 수 있습니다. 노드 이름은 언어 설정과 관계없이 workflow에 지정한 값을 그대로 표시합니다. 현재 버전은 연결 종료 시 닫아도 된다는 안내도 추가로 표시합니다.

## 주요 기능

- 기존 pane 너비의 약 35%를 사용하는 오른쪽 pane을 자동으로 엽니다.
- OmO workflow snapshot에서 노드 상태와 의존 관계를 받아 갱신합니다.
- 상태가 바뀌거나 확장이 재로딩되어도 같은 세션의 pane을 재사용합니다.
- 세션 종료 후에도 완료·실패한 실행 결과를 화면에 남깁니다.
- 스크롤과 여러 실행 사이의 전환을 지원합니다.
- 실행 중인 작업은 자동으로 펼치고 나머지 상태는 접되, 저장된 사용자 선택을 우선합니다.
- workflow DAG가 없어도 현재 세션의 일반 subtask를 표시합니다.
- 사용자가 접거나 펼친 노드 상태를 화면 갱신과 viewer 재실행 후에도 유지합니다.
- 직접 닫은 pane은 다시 열지 않습니다. `/dag-pane`으로 재개할 수 있습니다.
- Node 내장 기능을 사용하며, npm 의존성 설치나 OmO 패키지 수정이 필요하지 않습니다.

## 사전 조건

| 구성 요소 | 조건 |
| --- | --- |
| Node.js | 24 이상. 24.14.0과 26.7.0에서 검증했습니다. |
| OmO | `omo.dag.updated` 이벤트를 제공하는 버전. `5.0.0-0.beta.42` 및 Senpi `2026.9.4-3`에서 확인했습니다. |
| Herdr | 설치·실행되어 있고 `PATH`에서 `herdr`를 찾을 수 있어야 합니다. 아래 pane 명령을 지원해야 하며 protocol 20 환경에서 연동을 검증했습니다. |
| 터미널 | Herdr pane 안에서 OmO를 실행해야 합니다. UTF-8과 테두리 문자를 지원하는 폰트를 사용하세요. |

**이 확장은 Herdr에 OmO를 커스텀 에이전트로 등록할 필요가 없습니다.** Herdr의 일반 터미널 pane에서 `omo`를 직접 실행하면 됩니다. 확장은 pane ID와 일반 `herdr pane` 명령을 사용하며, `herdr agent start`나 사이드바의 에이전트 인식에 의존하지 않습니다.

구조상 이 방식으로 사용할 수 있지만, **커스텀 설정이 없는 순정 Herdr에서의 전체 동작은 아직 검증하지 않았습니다.** 정확한 확인 범위는 [검증 및 호환성 기록](VERIFICATION.md)을 참고하세요. 네이티브 macOS와 Windows 지원도 아직 검증하지 않았습니다.

## 설치

OmO와 Herdr를 먼저 각각 설치하세요. 패키지는 [npm](https://www.npmjs.com/package/omo-herdr-dag)에서 설치할 수 있습니다.

### npm으로 설치

```bash
npx omo-herdr-dag@latest install --dry-run
npx omo-herdr-dag@latest install
```

최초 설치 언어는 영어입니다. 한국어를 사용하려면 다음과 같이 설치하세요.

```bash
npx omo-herdr-dag@latest install --lang ko
```

한국어에서 영어로 되돌리는 경우를 포함해 영어를 명시적으로 선택하려면 `npx omo-herdr-dag@latest install --lang en`을 실행하세요. 다른 언어를 지정하지 않으면 업데이트 때도 기존 선택을 유지합니다.

`npm install -g omo-herdr-dag`로 CLI를 설치한 다음 `omo-herdr-dag install`을 실행할 수도 있습니다. npm 패키지를 받는 것만으로 OmO 설정이 변경되지는 않습니다. 명시적인 `install` 명령이 확장을 복사합니다. Herdr와 OmO는 별도로 설치해야 합니다.

### 소스에서 설치 (현재 사용 가능)

이 저장소를 clone한 뒤 설치 프로그램을 실행합니다.

```bash
git clone https://github.com/jc01rho/omo-herdr-dag.git
cd omo-herdr-dag
npm test
node scripts/install.mjs --dry-run
node scripts/install.mjs
```

npm 의존성은 없습니다. `--dry-run`은 파일을 변경하지 않고 설치 위치만 출력합니다. 소스 설치 프로그램에서도 `--lang en` 또는 `--lang ko`를 사용할 수 있습니다.

설치되는 파일은 다음과 같습니다.

```text
~/.omo/agent/
├── extensions/herdr-dag.js          # 확장 진입점
└── herdr-dag/integration/
    ├── current.json                # 현재 설치 세대
    └── generation-000001/           # 확장, src/, locale.json, LICENSE
```

Herdr 안에서 새 OmO 세션을 시작하거나, 기존 세션에서 `/reload`를 실행하세요. 첫 workflow DAG snapshot이 도착하면 pane이 자동으로 열립니다. OmO에서 `/dag-pane`을 실행하면 DAG를 기다리는 빈 화면을 미리 열 수도 있습니다.

### 다른 에이전트 디렉터리 사용

OmO가 다른 에이전트 디렉터리에서 확장을 불러오는 환경이라면 다음과 같이 설치합니다.

```bash
node scripts/install.mjs --agent-dir /path/to/your/agent-directory
```

이 옵션은 설치 위치만 변경합니다. OmO의 확장 탐색 설정이나 기본 런타임 상태 저장 위치는 변경하지 않습니다.
npm CLI에서도 같은 `--agent-dir` 옵션을 사용할 수 있습니다.

## 조작 방법

OmO에서 `/dag-pane`을 입력하면 workflow 시작 전에 viewer를 미리 열거나 직접 닫은 pane을 다시 열 수 있습니다. Workflow snapshot이 도착할 때까지 대기하고, 이후 상태 변경에 따라 그래프를 갱신합니다.

확장 시작 시 `<task 저장소>/dag/runs/`에서 현재 세션의 저장된 DAG checkpoint를 복원하고 task 상세 정보를 연결합니다. viewer 캐시가 비어 있으면 `/dag-pane`에서도 같은 복구를 수행하며 task를 다시 실행하지 않습니다. 다른 세션의 checkpoint는 표시하지 않습니다. 파일을 새로 설치해도 실행 중인 OmO에 이미 로딩된 코드는 바뀌지 않으므로, 복구 기능을 사용하기 전에 확장을 재로딩해야 합니다.

![OmO에서 /dag-pane을 입력했을 때 현재 세션의 DAG pane을 열거나 다시 여는 명령 설명이 표시되는 화면.](https://raw.githubusercontent.com/jc01rho/omo-herdr-dag/main/docs/screenshots/dag-pane-command.png)

| 위치 | 명령 또는 키 | 동작 |
| --- | --- | --- |
| OmO | `/dag-pane` | 현재 세션의 viewer를 열거나 다시 엽니다. |
| OmO | `/reload` | 확장을 로딩하거나 재로딩합니다. |
| DAG pane | `↑` / `↓`, `k` / `j` | 스크롤합니다. |
| DAG pane | `Page Up` / `Page Down` | 한 페이지씩 스크롤합니다. |
| DAG pane | `←` / `→` | 여러 실행 사이를 전환합니다. |
| DAG pane | `t` | DAG와 일반 작업 목록을 전환합니다. DAG가 없으면 일반 작업이 기본 화면입니다. |
| DAG pane | `Tab` / `n`, `Shift+Tab` / `p` | 다음·이전 노드를 선택하고 해당 상세 정보로 이동합니다. |
| DAG pane | `Space` / `Enter` | 선택한 노드의 상세 정보와 자식 작업을 접거나 펼칩니다. |
| DAG pane | `d` | 저장된 접기 상태를 변경하지 않고 선택한 작업·노드의 전체 상세 보기를 전환합니다. |
| DAG pane | `q`, `Ctrl+C`, `Ctrl+D` | viewer와 자동 생성된 pane을 닫습니다. |

`>`는 선택된 노드, `[-]`는 펼친 상태, `[+]`는 접은 상태입니다. 그래프와 의존 관계 목록은 상세 패널 위에 유지됩니다. 표시 상태는 `<snapshot 경로>.view.json`에 저장하며, workflow 갱신이 이 viewer 전용 파일을 덮어쓰지 않습니다.

일반 작업에서도 같은 선택·접기 키를 사용합니다. 실행 중인 작업을 먼저 표시하고, 일반 작업의 펼침 상태는 task ID별로 DAG 노드와 구분하여 저장합니다. DAG 화면에서도 일반 작업 개수를 확인할 수 있습니다.

펼친 작업 카드는 기본으로 상태·작업 설명, 에이전트·짧은 모델명, 한 줄 진행 문구, 경과 시간·턴·도구 호출 수의 4줄로 표시합니다. 긴 진행 문구는 축약합니다. `d`를 누르면 task ID, 정확한 시각, 전체 모델명과 제공된 진행 문구를 볼 수 있고, 다시 누르면 축약 카드로 돌아갑니다. 전체 상세 보기는 일시적이며 저장된 접기·펼치기 설정을 바꾸지 않습니다.

OmO 세션이 종료되면 마지막 그래프를 유지하고, 연결 종료 표시 아래에 닫아도 된다는 안내를 표시합니다. 한국어 선택 시에는 다음과 같습니다.

```text
○ 연결 종료 · 기록 보존
q를 눌러 닫아도 됩니다.
```

기본 영어 화면에는 `You can close this pane with q.`가 표시됩니다. 결과를 더 확인하려면 그대로 두고, 확인을 마쳤다면 `q`를 눌러 viewer와 자동 생성된 pane을 닫으세요. Viewer를 닫아도 workflow 작업을 취소하거나 저장된 snapshot을 삭제하지 않습니다. 이 안내는 연결이 종료됐을 때만 표시되며, 모든 workflow 작업이 성공했다는 뜻은 아닙니다.

## 설정과 로컬 데이터

| 환경 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `OMO_HERDR_DAG_STATE_DIR` | `~/.omo/agent/herdr-dag/` | snapshot과 pane 기록의 저장 위치. OmO 시작 전에 설정합니다. |
| `OMO_HERDR_DAG_TASK_STATE_DIR` | `<프로젝트>/.omo/senpi-task/` | `tasks/`를 포함하는 OmO task 저장소 경로. OmO의 `task.state_dir`을 변경했다면 같은 경로로 지정합니다. |
| `OMO_HERDR_DAG_LANG` | 설치 시 저장한 언어, 최초 `en` | `en` 또는 `ko`로 인터페이스 언어를 덮어씁니다. OmO 시작 또는 확장 재로딩 전에 설정합니다. |
| `OMO_HERDR_DAG_NODE` | 검증한 호스트 Node, 없으면 `PATH`의 `node` | Viewer를 실행할 Node.js 24+ 실행 파일. OmO 시작 전에 설정하며 공백이 있는 경로도 지원합니다. |

`install --lang ko`로 선택한 언어는 현재 설치 세대의 `locale.json`에 저장됩니다. 설치 결과의 `integration`이 해당 경로이며, `integration/current.json`에 현재 세대가 기록됩니다. 다른 `--lang` 값을 지정하지 않으면 업데이트 때도 유지합니다. 영어로 되돌리려면 `install --lang en`을 실행하세요. 환경 변수 설정이 저장된 언어보다 우선하며, 지원하지 않는 환경 변수 값은 영어로 처리합니다.

Herdr는 각 pane에 `HERDR_ENV`, `HERDR_PANE_ID`, `HERDR_SOCKET_PATH`를 제공합니다. 이 환경 밖에서는 확장이 비활성 상태를 유지합니다. 다른 pane을 대상으로 삼기 위해 이 변수들을 수동으로 설정하지 마세요.

`omob` 같은 독립 실행 빌드에서도 viewer용 Node.js 24 이상을 별도로 설치해야 합니다. 확장은 pane을 열기 전에 런타임을 검증하며, `node`가 버전 관리자의 shim인 경우에도 실제 Node 실행 파일 경로를 확인합니다. 컴파일된 OmO 바이너리로 viewer를 실행하지 않습니다. 경로를 직접 지정하려면 `OMO_HERDR_DAG_NODE=/absolute/path/to/node omob`로 시작하세요. 명시한 경로가 유효하지 않으면 다른 런타임으로 대체하지 않고 경고합니다.

Snapshot은 로컬 JSON 파일입니다. 세션·실행 ID, 이름, 노드 이름과 상태, task ID, 의존 관계, 오류 메시지를 저장합니다. Workflow 프롬프트는 제외하지만 이름이나 오류에 프로젝트 정보가 포함될 수 있습니다. 런타임 파일을 공개 이슈나 소스 저장소에 포함하지 마세요. 확장은 별도 외부 네트워크 서비스나 텔레메트리를 추가하지 않습니다.

작업 상세 정보는 노드의 task ID로 연결합니다. 제공되는 작업 설명, 에이전트·모델 정보, 진행 문구, 시각과 카운터를 실제로 연결된 자식 작업과 함께 표시합니다. 없는 정보는 추정하지 않습니다. 자식 작업 관계와 workflow 의존 관계는 별개이며, 의존 관계를 부모·자식 관계로 바꾸어 표시하지 않습니다.

진행 문구는 OmO가 제공하는 최신 응답 일부와 현재 도구 정보이며, 전체 대화 기록이 아닙니다. 저장할 때 진행 문구는 최대 512자, 작업 설명은 최대 2,000자로 제한하고 상세 패널에서 줄바꿈하여 표시합니다. 전체 task 프롬프트, 출력, 최종 응답은 이 snapshot에 복사하지 않습니다.

저장된 선택이 없으면 실행 중인 작업만 자동으로 펼치고, 나머지 상태는 접습니다. 자동으로 펼쳐진 작업은 완료되면 접힙니다. 사용자가 직접 선택한 상태는 항상 우선하므로, 실행 중 직접 접은 작업은 갱신되어도 접혀 있고 직접 펼친 작업은 완료 후에도 펼쳐집니다. 선택은 workflow snapshot과 별도 파일에 세션·실행·노드별로 저장하며 재시도, 실행 전환, viewer 재실행 후에도 유지합니다. 자동 상태 변화는 저장하지 않습니다. Space/Enter로 사용자 선택을 바꾸고, `d`로 전체 상세를 임시로 본 뒤 현재 적용되는 접기 상태로 돌아갑니다. `d`는 저장된 선택을 변경하지 않습니다. 작업 설명과 진행 문구에도 프로젝트 정보가 포함될 수 있으므로 로컬 기록을 공개하지 마세요.

## 업데이트와 제거

업데이트하려면 `npx omo-herdr-dag@latest install`을 다시 실행하면 업데이트됩니다. 소스로 설치했다면 새 소스를 받은 뒤 설치 프로그램을 다시 실행하세요. 매 설치마다 새 세대 디렉터리를 만들어 `/reload`가 캐시된 이전 내부 모듈 대신 새 코드를 읽게 합니다. 이전 세대는 백업으로 유지하고, 구형 단일 디렉터리 설치본은 백업 경로로 이동합니다. 런타임 기록과 언어 선택은 유지합니다. 설치본은 원본 소스 디렉터리나 npm 캐시와 독립적으로 동작합니다. 이미 실행 중인 OmO 세션에서는 `/reload`를 실행하세요. UI 변경을 적용하려면 기존 viewer 프로세스도 다시 실행해야 합니다.

제거하려면 `~/.omo/agent/extensions/herdr-dag.js`를 삭제하고 OmO를 재로딩하거나 재시작하세요. 기존 DAG pane은 직접 닫아 주세요. `~/.omo/agent/herdr-dag/`는 기록으로 보관하거나 별도로 삭제할 수 있습니다. 다른 에이전트 디렉터리에 설치했다면 해당 디렉터리의 진입점을 제거하세요.

## 자주 묻는 질문 (FAQ)

### OmO 플러그인인가요, Herdr 플러그인인가요?

**OmO 확장(extension)**입니다. 설치 프로그램이 OmO의 에이전트 디렉터리에 확장을 넣고, OmO 안에서 workflow 상태 변경을 구독합니다. DAG viewer를 열고 관리할 때 Herdr의 일반 `pane` 명령을 사용하며, Herdr 자체에 플러그인을 설치하지는 않습니다.

### Herdr가 없거나 Herdr 밖에서 OmO를 실행하면 어떻게 되나요?

| 실행 환경 | 동작 |
| --- | --- |
| Herdr가 설치되지 않음 | 확장은 설치할 수 있지만, 일반 터미널에서는 비활성 상태를 유지합니다. |
| Herdr가 설치되어 있어도 일반 터미널에서 OmO 실행 | 확장은 비활성화되고 `/dag-pane`도 등록되지 않습니다. Herdr 앱이 열려 있는 것만으로는 활성화되지 않습니다. |
| Herdr pane 안에서 OmO 실행 | 확장이 활성화되고 `/dag-pane`을 등록하며, workflow DAG가 도착하면 viewer를 엽니다. |
| Herdr 환경 변수는 있지만 CLI나 소켓을 사용할 수 없음 | Pane 조작에 실패하면 경고를 표시합니다. OmO 대화는 계속할 수 있습니다. |

Herdr가 제공하는 `HERDR_ENV=1`과 값이 있는 `HERDR_PANE_ID`, `HERDR_SOCKET_PATH`가 모두 있어야 활성화됩니다. 비활성 세션에서는 DAG 이벤트를 구독하거나 viewer pane을 열지 않습니다. Viewer를 사용하려면 환경 변수를 수동으로 지정하지 말고 Herdr pane 안에서 새 OmO 세션을 시작하세요.

### Herdr에 OmO를 커스텀 에이전트로 등록해야 하나요?

아니요. Herdr의 일반 터미널 pane에서 `omo` 또는 `omob`를 직접 실행하면 됩니다. 확장은 pane ID와 CLI 명령을 사용하므로 Herdr의 에이전트 등록이나 사이드바 인식이 필요하지 않습니다. 다만 커스텀 설정이 없는 순정 Herdr에서의 전체 동작 검증은 아직 남아 있습니다. 확인 범위는 [VERIFICATION.md](VERIFICATION.md)를 참고하세요.

## 문제 해결

| 증상 | 확인 사항 |
| --- | --- |
| `/dag-pane` 명령이 없습니다. | OmO를 재로딩하고 실제 사용하는 에이전트 디렉터리에 설치했는지, Herdr 안에서 실행 중인지 확인하세요. |
| Pane이 자동으로 열리지 않습니다. | workflow DAG 또는 현재 세션의 OmO task가 있으면 열립니다. OmO task 기록을 만들지 않는 일반 `parallel()` 호출은 표시 대상이 아닙니다. OmO 버전과 사용자 지정 task 저장소 경로를 확인하고, 직접 닫은 pane은 `/dag-pane`으로 다시 여세요. |
| 닫은 pane이 다시 열리지 않습니다. | 의도한 동작입니다. `/dag-pane`으로 다시 여세요. |
| `omob`에서 `Unknown options: --state, --close-pane`이 나옵니다. | 확장을 업데이트하고 실패한 DAG pane을 닫은 뒤, OmO에서 `/reload`, `/dag-pane`을 순서대로 실행하세요. 이전 실행 코드가 컴파일된 OmO 바이너리를 Node로 잘못 사용하던 문제입니다. |
| `DAG pane:` 경고가 나옵니다. | `PATH`에서 `herdr`를 찾을 수 있는지, `pane split`, `get`, `rename`, `run`을 지원하는지 확인하세요. 실행 실패나 응답 유실 시 중복 생성을 막기 위해 자동 재시도를 중지합니다. 생성 중이던 viewer pane을 확인하고 닫은 뒤 재시도하세요. |
| 의존 관계 선을 따라가기 어렵습니다. | 각 노드의 선행 ID와 그래프 아래 전체 간선 목록을 확인하세요. 필요한 경우 스크롤할 수 있습니다. |

## 동작 구조

```text
OmO workflow snapshot: omo.dag.updated
OmO task 진행 정보: omo.task.updated + 로컬 task 기록
시작 시 복구: 현재 세션의 DAG checkpoint
    → Senpi 공유 이벤트 버스: senpi:extension-rpc-event
    → 현재 부모 세션 ID로 필터링
    → 정규화한 로컬 snapshot 저장
    → Herdr pane 생성/재사용; TUI가 snapshot 파일 변경 감시
```

일반 subtask는 임의의 의존 관계 노드를 만들지 않고 별도 작업 목록에 표시합니다. 표시 중인 DAG에 이미 연결된 task는 일반 목록에서 제외하며, 자식 작업은 소유 task 아래에 표시합니다. 현재 세션의 작업과 명시적으로 연결된 자손만 수집합니다.

확장은 설치된 Senpi의 이벤트 버스를 구독합니다. Viewer를 만들 때 `herdr pane split --ratio 0.65 --no-focus`, `rename`, `run`을 사용합니다. Herdr의 비율은 기존 pane 기준이므로 새 pane에는 약 35%가 할당됩니다.

OmO/Senpi 내부 이벤트 계약에 의존하므로 버전이 바뀌면 호환성 확인이 필요합니다. 명시적인 workflow 간선을 읽으며 무관한 task 사이의 의존 관계를 추측하지 않습니다. 넓은 실행 단계는 여러 줄로 배치하고, 단계를 건너뛰는 의존 관계는 선행 ID와 간선 목록으로 표시합니다. 긴 이름과 오류 문구는 터미널 폭에 맞게 줄입니다.

## 개발

```bash
npm test
npm run build
npm run test:package
```

테스트는 OmO나 Herdr 설치 없이 실행할 수 있습니다. 임시 로컬 파일과 모의 pane 명령을 사용합니다. `build`는 의존성이 없는 JavaScript 배포 파일을 `dist/`에 모으고 문법을 검사합니다. `test:package`는 패키지를 압축한 뒤 임시 프로젝트에 오프라인으로 설치해 CLI·설치·업데이트·언어 선택을 검증합니다. `npm run check`로 세 단계를 한 번에 실행할 수 있습니다.

GitHub Actions는 Linux의 Node 24와 26에서 이 검증을 실행하고 npm `.tgz` 파일을 아티팩트로 업로드합니다. 실제 런타임 로더 및 pane 검증 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)에 설명되어 있습니다.

## 배포 방식

GitHub에는 소스와 CI 아티팩트를 보관합니다. npm 레지스트리에서 버전별 CLI·확장 패키지를 받습니다. 설치 프로그램이 런타임 파일을 OmO 에이전트 디렉터리에 복사하고 로컬에서 실행하므로 별도 애플리케이션 서버는 필요하지 않습니다. CI에서 받은 패키지는 `npm install -g ./omo-herdr-dag-1.0.0.tgz`로 설치한 뒤 `omo-herdr-dag install`을 실행할 수 있습니다.

`v1.0.0` 같은 버전 태그를 push하면 **Release to GitHub and npm** workflow가 Node 24·26 검증과 태그·패키지 버전 일치 확인 후 검증한 패키지를 자동으로 npm에 게시합니다. 동시에 [GitHub Releases](https://github.com/jc01rho/omo-herdr-dag/releases)에도 자동 생성한 릴리스 노트와 `.tgz` 다운로드를 등록합니다. npm 게시에는 사전 인증 설정이 필요하며, GitHub 릴리스는 기본 GitHub 토큰으로 독립적으로 생성됩니다. 일반 브랜치 push는 CI만 실행하고, 게시 workflow의 수동 실행은 실제 게시 없이 dry run으로 검증합니다. 사전 릴리스 버전은 npm의 `next` 태그로 게시합니다. 인증 설정과 릴리스 절차는 [RELEASING.md](RELEASING.md)에 정리했습니다.

기여, 호환성 제보, 터미널 렌더링 개선을 환영합니다. 변경을 제안하기 전에 [CONTRIBUTING.md](CONTRIBUTING.md)를 확인해 주세요.

## 라이선스

[MIT](LICENSE). 독립적인 커뮤니티 확장이며 OmO 또는 Herdr의 공식 구성 요소가 아닙니다.
