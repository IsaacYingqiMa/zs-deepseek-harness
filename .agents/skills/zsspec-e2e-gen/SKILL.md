---
name: zsspec-e2e-gen
description: 基于 CHK 检查清单中 automation=auto 的检查项生成 Playwright 端到端测试代码（不执行）。当用户提到"生成测试代码"、"生成 e2e 代码"、"写 Playwright 测试"、"生成自动化测试"，或用户已有 CHK 文档并需要转化为 Playwright 代码时，务必使用此 skill。
---

# ZSSpec Playwright 代码生成器

你是一位专业的端到端测试工程师。你的职责是读取 `specs/checklist/` 目录下的 CHK 检查清单文档，筛选其中 `automation=auto` 的检查项，并将其转化为可执行的 Playwright 测试代码，**生成后停止，等待用户 review**。

## 核心理念

测试代码不是文档的翻译——它是**可执行的验收证明**。生成的每一行代码都应能直接追溯到 CHK 文档中 `automation=auto` 检查项的具体步骤和预期结果。此 skill **只生成代码，不执行**——用户 review 确认后，由 `zsspec-e2e-run` skill 负责执行。

---

## 工作流程

### 第一步：Pre-flight 检查

在生成代码前，先验证输入完整性：

1. 查找 `specs/checklist/` 目录下所有 `CHK-*.md` 文件
2. 读取检查项列表与详情区，提取所有 `automation=auto` 的检查项
3. 验证每个 auto 检查项的必填信息：`编号`、`关联需求`、`优先级`、`类型`、`自动化`、`检查步骤`、`预期结果`
4. 跳过 `automation=static` 与 `automation=manual` 的检查项
5. 如有格式错误或缺失字段的检查项，汇总并提示用户，但不中断（跳过问题检查项继续生成）

### 第二步：分析项目环境

1. 查找项目根目录，确认前端项目位置（`package.json` 所在目录）
2. 确认 Playwright 是否已安装（检查 `package.json` 的 devDependencies 中是否有 `@playwright/test`）
3. 若未安装，生成安装命令提示（不自动执行，打印给用户）：
   ```
   npm install -D @playwright/test
   npx playwright install chromium
   ```
4. 确认 `playwright.config.ts` 是否存在，若不存在则生成基础配置

### 第三步：生成 Page Object

从 CHK 文档中 `automation=auto` 检查项的测试步骤中提取所有涉及的页面，为每个页面生成对应的 Page Object 文件。

### 第四步：生成测试代码

按模块和分类组织，生成测试文件，每条测试用例对应一个 `test()` 调用。

### 第五步：输出总结

生成完成后，输出以下信息：
- 生成的文件列表
- 覆盖的 CHK(auto) 检查项数量（vs 总 auto 检查项数）
- 跳过的检查项及原因
- 提醒用户：review 代码后使用 `zsspec-e2e-run` 执行测试

---

## 目录结构

```
tests/e2e/
├── playwright.config.ts         # Playwright 配置（如不存在则生成）
├── pages/                       # Page Object Model
│   ├── base.page.ts             # 基础页面（通用导航、等待逻辑）
│   └── <页面名>.page.ts          # 各页面的 Page Object
├── fixtures/                    # 自定义 fixture
│   └── test-data.fixture.ts     # 测试数据 fixture
└── tests/                       # 测试用例文件
    └── <模块>/
        └── test_<模块>_<分类>.spec.ts
```

---

## 选择器策略

生成代码时，按以下优先级选择元素定位方式：

| 优先级 | 定位方式 | 示例 | 适用场景 |
|--------|----------|------|----------|
| 1 | `data-testid` | `page.getByTestId('btn-submit')` | CHK 文档步骤中标注了 `[data-testid="..."]` |
| 2 | `role` | `page.getByRole('button', { name: '提交' })` | 有明确语义角色的元素 |
| 3 | `text` | `page.getByText('创建成功')` | 断言文本内容时 |
| 4 | `label` | `page.getByLabel('用户名')` | 表单输入框 |
| 5 | `placeholder` | `page.getByPlaceholder('请输入...')` | 输入框备选 |
| 6 | CSS selector | `page.locator('.custom-class')` | 以上均不适用时（最后手段） |

**规则**：
- CHK 文档步骤中明确标注的定位方式必须原样使用
- CHK 文档未标注时，按优先级表自动推断
- 生成的 Page Object 中集中管理选择器，测试文件不直接写选择器字符串

---

## 代码生成规范

### playwright.config.ts

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
```

### Page Object 基类

```typescript
// tests/e2e/pages/base.page.ts
import { Page } from '@playwright/test'

export class BasePage {
  constructor(protected page: Page) {}

  async goto(path: string) {
    await this.page.goto(path)
  }

  async waitForPageReady() {
    await this.page.waitForLoadState('networkidle')
  }

  async getTitle() {
    return this.page.title()
  }
}
```

### Page Object 示例

```typescript
// tests/e2e/pages/report.page.ts
import { Page, Locator } from '@playwright/test'
import { BasePage } from './base.page'

export class ReportPage extends BasePage {
  // 元素定位器集中管理
  readonly btnNewReport: Locator
  readonly inputReportName: Locator
  readonly selectDatasource: Locator
  readonly btnSubmit: Locator
  readonly msgSuccess: Locator

  constructor(page: Page) {
    super(page)
    this.btnNewReport = page.getByTestId('btn-new-report')
    this.inputReportName = page.getByTestId('input-report-name')
    this.selectDatasource = page.getByTestId('select-datasource')
    this.btnSubmit = page.getByTestId('btn-submit')
    this.msgSuccess = page.getByTestId('report-success-msg')
  }

  async createReport(name: string, datasource: string) {
    await this.btnNewReport.click()
    await this.inputReportName.fill(name)
    await this.selectDatasource.selectOption({ label: datasource })
    await this.btnSubmit.click()
  }

  async getSuccessMessage() {
    return this.msgSuccess.textContent()
  }

  async isSuccessVisible() {
    return this.msgSuccess.isVisible()
  }
}
```

### 测试文件示例

```typescript
/**
 * 模块: report
 * 关联需求: REQ-report
 * 关联检查清单: CHK-report
 *
 * 由 zsspec-e2e-gen 从 CHK-report.md 中的 automation=auto 检查项自动生成
 * 生成时间: <时间戳>
 */
import { test, expect } from '@playwright/test'
import { ReportPage } from '../../pages/report.page'

test.describe('报告模块 - 功能测试', () => {
  let reportPage: ReportPage

  test.beforeEach(async ({ page }) => {
    reportPage = new ReportPage(page)
  })

  /**
   * CHK-report-FUNC-001: 创建新报告
   * 关联需求: REQ-report-001
   * 关联检查项: CHK-report-001
   * 优先级: P0
   */
  test('CHK-report-FUNC-001: 创建新报告', async ({ page }) => {
    // 前置条件: 用户已登录，位于 dashboard 页面
    await reportPage.goto('/dashboard')

    // 步骤 1-5: 填写并提交报告创建表单
    await reportPage.createReport('月报-2026Q1', 'sales_db')

    // 预期结果 1: 成功提示可见且包含 "创建成功"
    await expect(reportPage.msgSuccess).toBeVisible()
    await expect(reportPage.msgSuccess).toContainText('创建成功')

    // 预期结果 2: 页面跳转至报告详情页
    await expect(page).toHaveURL(/\/report\//)
  })

  /**
   * CHK-report-ERR-001: 报告名为空时提交应报错
   * 关联需求: REQ-report-002
   * 关联检查项: CHK-report-005
   * 优先级: P1
   */
  test('CHK-report-ERR-001: 报告名为空时提交应报错', async ({ page }) => {
    await reportPage.goto('/dashboard')
    await reportPage.btnNewReport.click()
    // 不填写报告名，直接提交
    await reportPage.btnSubmit.click()

    // 预期结果: 显示必填错误提示
    await expect(page.getByText('报告名称不能为空')).toBeVisible()
  })
})
```

### 测试数据 Fixture

```typescript
// tests/e2e/fixtures/test-data.fixture.ts
import { test as base } from '@playwright/test'

export interface TestData {
  reportName: string
  datasource: string
}

export const test = base.extend<{ testData: TestData }>({
  testData: async ({}, use) => {
    await use({
      reportName: '自动化测试报告',
      datasource: 'test_db',
    })
  },
})

export { expect } from '@playwright/test'
```

---

## 代码生成规则

1. **注释溯源**：每个 `test()` 函数的注释必须包含 CHK 编号、关联需求、关联检查项、优先级
2. **步骤对应**：测试代码中的注释应与 CHK 文档步骤一一对应（如 `// 步骤 1: ...`）
3. **POM 封装**：页面操作封装在 Page Object 中，测试文件通过 PO 方法调用，不直接写 `page.locator()`
4. **等待条件**：使用 `expect().toBeVisible()`、`waitForResponse()` 等条件等待，不使用 `page.waitForTimeout()`
5. **测试独立性**：每个 `test()` 独立运行，`beforeEach` 中准备前置条件，不依赖其他用例的状态
6. **文件头注释**：每个测试文件头部标注来源 CHK 文档名、生成时间
7. **不硬编码配置**：baseURL 等配置从 `playwright.config.ts` 或环境变量读取

---

## 与上下游 skill 的关系

```
zsspec-test-gen
    ↓ specs/checklist/<模块>/CHK-*.md
zsspec-e2e-gen（本 skill）
    ↓ tests/e2e/ 下的 Playwright 代码
zsspec-e2e-run
    ↓ 执行测试 → specs/checklist/reports/<时间戳>/report.md
    ↓ 回写 CHK(auto) 检查项状态
```

**输入**：`zsspec-test-gen` 生成的 CHK 文档中 `automation=auto` 的检查项（提取检查步骤 + 预期结果 + 关联需求）

**输出**：`tests/e2e/` 下的 Playwright 测试代码（只生成，不执行）

---

## 注意事项

- 只生成代码，不运行测试——执行由 `zsspec-e2e-run` 负责
- `automation: manual` 的用例不生成代码，在输出总结中标注"需人工验证"
- `automation: mock-required` 的用例生成代码框架但标注 `// TODO: 需要配置 mock 服务`
- `automation: unit-only` 的用例不生成 e2e 代码，在输出总结中建议用单元测试覆盖
- CHK 文档中缺少 `automation=auto` 所需字段的检查项，跳过并在输出中报告
- 如果项目尚未安装 Playwright，输出安装命令提示用户手动执行，不自动安装
