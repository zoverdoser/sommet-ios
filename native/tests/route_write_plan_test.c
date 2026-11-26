/* Standalone regression test. Link with the navigation builder, crc16.c, and sha256.c. */
#include "device_driver_ambit3_navigation.h"

#include <assert.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

static void assert_covered(const ambit3_nav_plan_t *plan, uint32_t base, size_t length)
{
    uint32_t end = base + length;
    uint32_t next = base;
    for (size_t i = 0; i < plan->write_count; i++) {
        const ambit3_nav_write_t *write = &plan->writes[i];
        if (write->address < base || write->address >= end) continue;
        assert(write->address == next);
        assert(write->length <= end - next);
        next += write->length;
    }
    assert(next == end);
}

static void check_plan(size_t count, size_t points_per_route, size_t waypoints_per_route)
{
    ambit3_nav_route_t routes[AMBIT3_MAX_ROUTES] = {0};
    ambit3_nav_point_t points[AMBIT3_MAX_ROUTE_POINTS] = {0};
    ambit3_nav_waypoint_t waypoints[AMBIT3_MAX_WAYPOINTS] = {0};
    ambit3_nav_plan_t plan;
    for (size_t i = 0; i < points_per_route; i++) {
        points[i].latitude = 310000000 + (int32_t)i * 100;
        points[i].longitude = 1213700000;
    }
    for (size_t i = 0; i < count; i++) {
        strcpy(routes[i].name, "Route");
        routes[i].point_count = (uint16_t)points_per_route;
        routes[i].points = points;
        routes[i].distance = 1000;
        routes[i].waypoint_count = (uint16_t)waypoints_per_route;
        routes[i].waypoints = waypoints;
    }

    assert(ambit3_navigation_plan_sized(routes, count, 54, &plan) == 0);
    assert_covered(&plan, AMBIT3_WAYPOINT_BASE, 6);
    assert_covered(&plan, AMBIT3_WAYPOINT_DESC, 54 * count * waypoints_per_route);
    assert_covered(&plan, AMBIT3_ROUTE_BASE, 32);
    assert_covered(&plan, AMBIT3_ROUTE_DESC, 52 * count);
    assert_covered(&plan, AMBIT3_ROUTE_POINTS, 12 * count * points_per_route);
    assert_covered(&plan, AMBIT3_ROUTE_INDEX, 20 * count);
    assert_covered(&plan, AMBIT3_WAYPOINT_INDEX, 4 * count * waypoints_per_route);
    ambit3_navigation_plan_free(&plan);
}

int main(void)
{
    check_plan(10, 276, 4);   /* Around the size of the failed Traverse Alpha transfer. */
    check_plan(50, 200, 2);   /* All 50 routes, 10,000 points and 100 waypoints. */
    return 0;
}
