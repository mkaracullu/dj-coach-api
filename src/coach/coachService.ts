import {
  coachApiContractVersion,
  CoachApiRequestV1,
  CoachApiSuccessResponseV1,
} from "../contracts/CoachApiContract";
import { buildMockCoachResponse } from "./mockCoach";
import { validateCoachApiSuccessResponse } from "./coachResponseValidator";

export type CoachService = {
  respond(request: CoachApiRequestV1): Promise<unknown>;
};

export const mockCoachService: CoachService = {
  async respond(request) {
    return {
      contractVersion: coachApiContractVersion,
      requestId: request.requestId,
      response: buildMockCoachResponse(request),
    };
  },
};

export async function getCoachApiResponse(
  request: CoachApiRequestV1,
  service: CoachService = mockCoachService
): Promise<CoachApiSuccessResponseV1> {
  const candidate = await service.respond(request);
  return validateCoachApiSuccessResponse(candidate, request.requestId);
}
