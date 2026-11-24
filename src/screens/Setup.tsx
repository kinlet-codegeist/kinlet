import {
  ArrowLeft,
  ArrowRight,
  Check,
  Layers,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../app-context";
import {
  ArtifactIcon,
  Badge,
  BrandMark,
  Button,
  Loading,
  Notice,
  PageTitle,
  Stepper,
  TextField,
} from "../components/ui";
import { demoDelay } from "../data/gateway";
import { capture } from "../domain/model";

export function Setup() {
  const { state, act } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(state.workspaceName);
  const [objective, setObjective] = useState(state.objective);
  const [confluence, setConfluence] = useState(true);
  const [ids, setIds] = useState(Object.keys(state.artifacts));
  const [busy, setBusy] = useState(false);
  const sources = Object.values(state.artifacts).filter(
    (a) => confluence || a.kind === "issue",
  );
  const selected = sources.filter((a) => ids.includes(a.id));
  const finish = async () => {
    setBusy(true);
    await demoDelay(850);
    const id = act((s) => {
      s.workspaceName = name.trim();
      s.objective = objective.trim();
      s.artifacts = Object.fromEntries(selected.map((a) => [a.id, a]));
      const id = capture(
        s,
        "Our first shared checkpoint",
        "Initial versions of the selected sample sources.",
      );
      s.approvedId = id;
      s.setupDone = true;
      return id;
    }, "Your first sample checkpoint is saved.");
    if (id) navigate(`/checkpoints/${id}`);
    else setBusy(false);
  };
  return (
    <div className="page setup-page">
      <PageTitle
        title="Sample workspace setup"
        description="Choose tickets and pages for the first checkpoint."
      />
      <div className="card setup-card">
        <Stepper
          steps={["Connections", "Choose work", "Purpose", "Coverage", "Save"]}
          current={step}
        />
        <div className="setup-content">
          {busy ? (
            <Loading label="Saving selected sources…" />
          ) : step === 0 ? (
            <>
              <div className="setup-step-icon">
                <Layers size={27} />
              </div>
              <h2>Select source products</h2>
              <p>
                The sample includes Jira tickets. Select Confluence to include pages as well.
              </p>
              <div className="setup-connections">
                <div>
                  <span className="integration-product jira-product">J</span>
                  <span>
                    <strong>Jira</strong>
                    <small>Work items and project context</small>
                  </span>
                  <Badge tone="blue">Sample workspace</Badge>
                  <Check size={17} />
                </div>
                <label>
                  <span className="integration-product confluence-product">
                    <Layers size={23} />
                  </span>
                  <span>
                    <strong>Confluence</strong>
                    <small>Specifications and decisions</small>
                  </span>
                  <Badge>Optional</Badge>
                  <input
                    type="checkbox"
                    checked={confluence}
                    onChange={(e) => setConfluence(e.target.checked)}
                  />
                </label>
              </div>

            </>
          ) : step === 1 ? (
            <>
              <h2>Select tracked work</h2>
              <p>
                The workspace will include the sources you select here.
              </p>
              <div className="setup-source-list">
                {sources.map((a) => (
                  <label key={a.id}>
                    <input
                      type="checkbox"
                      checked={ids.includes(a.id)}
                      onChange={(e) =>
                        setIds(
                          e.target.checked
                            ? [...ids, a.id]
                            : ids.filter((id) => id !== a.id),
                        )
                      }
                    />
                    <ArtifactIcon artifact={a} />
                    <span>
                      <strong>{a.title}</strong>
                      <small>
                        {a.key} · v{a.version}
                      </small>
                    </span>
                    <Badge>{a.kind === "page" ? "Confluence" : "Jira"}</Badge>
                  </label>
                ))}
              </div>
            </>
          ) : step === 2 ? (
            <>
              <h2>Define the project objective</h2>
              <p>
                The objective appears on the project overview.
              </p>
              <div className="form-stack">
                <TextField label="Workspace name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </TextField>
                <TextField label="Project objective">
                  <textarea
                    rows={4}
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                  />
                </TextField>
                <div className="required-constraint">
                  <ShieldCheck size={18} />
                  <span>
                    <strong>Payment policy</strong>
                    <p>
                      The sample payment policy stays available as context when
                      selected.
                    </p>
                  </span>
                </div>
              </div>
            </>
          ) : step === 3 ? (
            <>
              <h2>Checkpoint contents</h2>
              
              <div className="coverage-rows">
                <div>
                  <span>Selected Jira work items</span>
                  <Badge tone="blue">
                    {selected.filter((a) => a.kind === "issue").length}
                  </Badge>
                </div>
                <div>
                  <span>Selected Confluence pages</span>
                  <Badge tone="blue">
                    {selected.filter((a) => a.kind === "page").length}
                  </Badge>
                </div>
                <div>
                  <span>Supplied agent instructions & app activity</span>
                  <Badge tone="green">Included in later runs</Badge>
                </div>
                <div>
                  <span>
                    Unrelated chats, attachment files, model internal state
                  </span>
                  <Badge>Outside scope</Badge>
                </div>
              </div>
              <Notice>
                Sample checkpoints are saved in this browser.
              </Notice>
            </>
          ) : (
            <>
              <div className="setup-success-mark">
                <BrandMark size={46} />
              </div>
              <h2>Save the first checkpoint</h2>
              <p>
                Save the selected tickets and pages in <strong>{name}</strong>.
              </p>
              <div className="setup-recap">
                <span>
                  <Layers size={17} />
                  {selected.length} selected sources
                </span>

              </div>
            </>
          )}
        </div>
        <div className="setup-footer">
          <Button
            variant="ghost"
            onClick={() => setStep(step - 1)}
            disabled={step === 0 || busy}
          >
            <ArrowLeft size={14} />
            Back
          </Button>
          <span>Step {step + 1} of 5</span>
          {step === 4 ? (
            <Button variant="primary" onClick={finish} disabled={busy}>
              {busy ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Layers size={15} />
              )}
              Save first checkpoint
              <ArrowRight size={14} />
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={
                (step === 1 && !selected.length) ||
                (step === 2 && (!name.trim() || !objective.trim()))
              }
              onClick={() => setStep(step + 1)}
            >
              Continue
              <ArrowRight size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
