sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast) {
    "use strict";

    // Maps route key → breadcrumb text shown in ShellBar secondTitle
    var mRouteLabels = {
        fieldMaster: "Fields \u203a Field Master",
        fieldMasterDetail: "Fields \u203a Field Master",
        validationRules: "Fields \u203a Validation Rules",
        validationRuleDetail: "Fields \u203a Validation Rules",
        valueTables: "Fields \u203a Value Tables",
        valueTableDetail: "Fields \u203a Value Tables",
        fieldGroups: "Fields \u203a Field Groups",
        fieldGroupDetail: "Fields \u203a Field Groups",
        bpCategories: "Business Partner \u203a BP Categories",
        bpCategoryDetail: "Business Partner \u203a BP Categories",
        bpRoles: "Business Partner \u203a BP Roles",
        bpRoleDetail: "Business Partner \u203a BP Roles",
        accountGroups: "Business Partner \u203a Account Groups",
        accountGroupDetail: "Business Partner \u203a Account Groups",
        releaseCriteria: "Release Strategy \u203a Release Criteria",
        releaseCodes: "Release Strategy \u203a Release Codes",
        releaseStrategies: "Release Strategy \u203a Release Strategies",
        createBP: "Runtime Preview \u203a Create BP",
        myApprovals: "Runtime Preview \u203a My Approvals",
        authRoles: "Authorizations \u203a Authorization Roles",
        users: "Authorizations \u203a Users",
        help: "Help",
        appSettings: "Settings"
    };

    return Controller.extend("mdm.portal.controller.App", {

        onInit: function () {
            var oUiModel = new JSONModel({
                pendingApprovals: 0,
                shellBreadcrumb: mRouteLabels.fieldMaster
            });
            this.getView().setModel(oUiModel, "ui");
            this._loadPendingApprovalCount();

            // The breadcrumb was previously only updated from onNavItemSelect,
            // so it only changed when a side-nav item was clicked directly.
            // Any other navigation — opening a row from a list, a link inside a
            // detail page, browser back/forward, a deep link — left it stuck on
            // whatever it was last set to. Hooking the router's own
            // routeMatched event covers every navigation path uniformly.
            this.getOwnerComponent().getRouter()
                .attachRouteMatched(this._onAnyRouteMatched, this);

            // Correct the content margin after initial render
            setTimeout(function () {
                this._adjustContentWidth();
                this._fixClipPath();
            }.bind(this), 500);

            setTimeout(function () {
                var oToolPage = this.byId("toolPage");
                if (!oToolPage) return;
                var oToolPageDom = oToolPage.getDomRef();
                if (!oToolPageDom) return;

                // Observe the whole ToolPage subtree. Pages are created and
                // destroyed by routing, so watching a single wrapper found at
                // startup misses pages navigated to later. On any style/child
                // change, strip clip-path from every DynamicPage wrapper.
                var fnStrip = this._fixClipPath.bind(this);
                var oObserver = new MutationObserver(function () {
                    fnStrip();
                });

                oObserver.observe(oToolPageDom, {
                    attributes: true,
                    attributeFilter: ["style"],
                    subtree: true,
                    childList: true
                });

                this._oClipPathObserver = oObserver;
                // Run once now in case a page is already rendered
                fnStrip();
            }.bind(this), 600);
        },
        _adjustContentWidth: function () {
            var oToolPage = this.byId("toolPage");
            if (!oToolPage) return;
            var oToolPageDom = oToolPage.getDomRef();
            if (!oToolPageDom) return;

            var oSideContent = oToolPageDom.querySelector(".sapTntToolPageSideContent");
            var oMainContent = oToolPageDom.querySelector(".sapTntToolPageMainContent");
            if (!oMainContent) return;

            var iSideWidth = oSideContent
                ? oSideContent.getBoundingClientRect().width : 0;

            oMainContent.style.marginLeft = iSideWidth + "px";
            oMainContent.style.width = "calc(100% - " + iSideWidth + "px)";

            // Fire resize so SAP Table re-evaluates demandPopin columns
            window.dispatchEvent(new Event("resize"));

            // Invalidate the current page's table (id differs per page:
            // fieldTable / groupTable / valueTable / ruleTable) so columns
            // recalculate after the side nav toggles.
            var oNavContainer = this.byId("appPages");
            if (oNavContainer) {
                var oPage = oNavContainer.getCurrentPage();
                if (oPage && oPage.findAggregatedObjects) {
                    var aTables = oPage.findAggregatedObjects(true, function (oCtrl) {
                        return oCtrl.isA && oCtrl.isA("sap.m.Table");
                    });
                    aTables.forEach(function (oTable) { oTable.invalidate(); });
                }
            }
        },

        // ── Pending approval count (OData v4 safe) ─────────────────────
        _loadPendingApprovalCount: function () {
            // The approval runtime (CRReleaseStep / approval inbox) isn't built
            // yet, and there is no /ApprovalItems entity in the service. Binding
            // to it threw "no metadata for path /ApprovalItems/status" on every
            // page. Until the approval module exists, report zero.
            this.getView().getModel("ui").setProperty("/pendingApprovals", 0);
        },

        _loadPendingApprovalCount_DISABLED: function () {
            var oModel = this.getOwnerComponent().getModel();

            var oBinding = oModel.bindList("/ApprovalItems", null, null, null, {
                $count: true
            });
            oBinding.filter(new Filter("status", FilterOperator.EQ, "PENDING"));

            oBinding.requestContexts(0, 1)
                .then(function () {
                    return oBinding.getHeaderContext().requestProperty("$count");
                })
                .then(function (iCount) {
                    this.getView().getModel("ui")
                        .setProperty("/pendingApprovals", iCount || 0);
                }.bind(this))
                .catch(function (oErr) {
                    console.warn("Could not load pending approvals", oErr);
                });
        },

        // ── ShellBar breadcrumb helper ──────────────────────────────────
        _onAnyRouteMatched: function (oEvent) {
            this._setShellBreadcrumb(oEvent.getParameter("name"));
        },
        _setShellBreadcrumb: function (sKey) {
            var sLabel = mRouteLabels[sKey] || sKey;
            this.getView().getModel("ui").setProperty("/shellBreadcrumb", sLabel);
        },
        // ── Navigation item select ──────────────────────────────────────
        onNavItemSelect: function (oEvent) {
            var oItem = oEvent.getParameter("item");
            if (!oItem) return;

            var sKey = oItem.getKey();
            if (sKey) {
                // Only navigate if a route is actually defined; menu items for
                // screens that aren't built yet (Release Criteria, Create BP,
                // Authorizations, etc.) show a notice instead of throwing.
                var oRouter = this.getOwnerComponent().getRouter();
                if (oRouter.getRoute(sKey)) {
                    oRouter.navTo(sKey);
                } else {
                    MessageToast.show(oItem.getText() + " — coming soon");
                }
            }

            // Auto-collapse on Phone after selection
            if (sap.ui.Device.system.phone) {
                this.byId("toolPage").setSideExpanded(false);
            }
        },
        onSideNavToggle: function () {
            var oToolPage = this.byId("toolPage");
            oToolPage.setSideExpanded(!oToolPage.getSideExpanded());

            // Wait for SAP animation to finish then remeasure
            setTimeout(function () {
                this._adjustContentWidth();
                this._fixClipPath();
            }.bind(this), 300);
        },
        // ── Remove SAP's clip-path inline style that hides content ──────
        _fixClipPath: function () {
            var oToolPage = this.byId("toolPage");
            if (!oToolPage) return;
            var oToolPageDom = oToolPage.getDomRef();
            if (!oToolPageDom) return;

            // Target EVERY DynamicPage content wrapper currently in the DOM,
            // so the fix works for FieldMaster, FieldGroups, ValueTables,
            // ValidationRules — whichever page is showing.
            var aWrappers = oToolPageDom.querySelectorAll(
                "[id$='-contentWrapper'], .sapFDynamicPageContentWrapper"
            );
            aWrappers.forEach(function (oWrapper) {
                if (oWrapper.style.clipPath && oWrapper.style.clipPath !== "none") {
                    oWrapper.style.clipPath = "none";
                }
                oWrapper.style.overflow = "auto";
            });
        },
        // ── ShellBar search icon pressed ────────────────────────────────
        onSearchOpen: function () {
            // ShellBar handles its own search overlay; stub for custom logic
        },

        // ── Notifications ───────────────────────────────────────────────
        onNotificationsPress: function () {
            // TODO: open NotificationsPopover
        },
        onExit: function () {
            if (this._oClipPathObserver) {
                this._oClipPathObserver.disconnect();
            }
        },
        // ── User avatar / profile ───────────────────────────────────────
        onAvatarPress: function () {
            // TODO: open user menu Popover
        }
    });
});