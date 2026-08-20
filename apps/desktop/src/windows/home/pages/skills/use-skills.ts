/**
 * INPUT: HomeClientContext's current WsClient generation
 * OUTPUT: React-bound Skills controller state/actions that retire on client replacement
 * POS:    Home Skills hook; one controller per mounted page with disposable in-memory state only
 */
import { useEffect, useMemo, useState } from "react";
import { useHomeClient } from "../../home-client-context.ts";
import { createSkillsController, INITIAL_SKILLS_STATE } from "./skills-controller.ts";
export function useSkills() { const { client, status } = useHomeClient(); const [state, setState] = useState(INITIAL_SKILLS_STATE); const controller = useMemo(() => createSkillsController(setState), []); useEffect(() => { controller.bind(client); return () => controller.bind(null); }, [client, controller]); return { state, controller, status, connectionReady: client !== null && status.kind === "connected" }; }
