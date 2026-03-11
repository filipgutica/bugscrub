import type { z } from 'zod'

import { assertionSchema } from '../schemas/assertion.schema.js'
import { capabilitySchema } from '../schemas/capability.schema.js'
import { authConfigSchema, bugScrubConfigSchema } from '../schemas/config.schema.js'
import { findingSchema } from '../schemas/finding.schema.js'
import { assertionResultSchema, runResultSchema } from '../schemas/run-result.schema.js'
import { signalSchema } from '../schemas/signal.schema.js'
import { surfaceSchema } from '../schemas/surface.schema.js'
import { workflowSchema } from '../schemas/workflow.schema.js'

export type WorkflowConfig = z.infer<typeof workflowSchema>
export type WorkflowStep = WorkflowConfig['setup'][number]
export type WorkflowTask = WorkflowConfig['exploration']['tasks'][number]
export type SurfaceConfig = z.infer<typeof surfaceSchema>
export type CapabilityConfig = z.infer<typeof capabilitySchema>
export type AssertionConfig = z.infer<typeof assertionSchema>
export type SignalConfig = z.infer<typeof signalSchema>
export type BugScrubConfig = z.infer<typeof bugScrubConfigSchema>
export type AuthConfig = z.infer<typeof authConfigSchema>
export type Finding = z.infer<typeof findingSchema>
export type AssertionResult = z.infer<typeof assertionResultSchema>
export type RunResult = z.infer<typeof runResultSchema>
