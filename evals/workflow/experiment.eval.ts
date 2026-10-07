import { describeWorkflow, runWorkflowCases } from "../src/index.js";
import { cases } from "./experiment.cases.js";

describeWorkflow("experiment", () => runWorkflowCases(cases));
