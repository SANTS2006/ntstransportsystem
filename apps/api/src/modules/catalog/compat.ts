import { AppError } from '../../platform/errors.js';

export interface RouteRequirements {
  name?: string;
  allowedVehicleTypes: readonly string[] | null;
  minSeats: number;
}
export interface VehicleFacts {
  registration: string;
  type: string;
  seatingCapacity: number;
}

const pretty = (t: string) => t.toLowerCase().replace(/_/g, ' ');

/**
 * A vehicle may only run a route it is suitable for: an allowed type (an empty list means any type)
 * and at least the route's minimum number of seats.
 */
export function assertVehicleCompatible(route: RouteRequirements, vehicle: VehicleFacts): void {
  const allowed = route.allowedVehicleTypes ?? [];
  if (allowed.length > 0 && !allowed.includes(vehicle.type)) {
    throw AppError.conflict(
      `${vehicle.registration} is a ${pretty(vehicle.type)}; this route needs: ${allowed.map(pretty).join(', ')}`,
    );
  }
  if (vehicle.seatingCapacity < route.minSeats) {
    throw AppError.conflict(
      `${vehicle.registration} has ${vehicle.seatingCapacity} seats; this route needs at least ${route.minSeats}`,
    );
  }
}
