import React, { useEffect, useLayoutEffect, useRef } from 'react';

import { loadModules, loadCss } from 'esri-loader';
import IMapView from 'esri/views/MapView';
import IWebMap from 'esri/WebMap';
import IPoint from 'esri/geometry/Point';
import IExtent from 'esri/geometry/Extent';
import IwatchUtils from 'esri/core/watchUtils';
import IZoom from 'esri/widgets/Zoom';
import { MapCenter } from '../../store/reducers/Map';
import { setHashParam } from '../../utils/URLHashParams';
import IBookmarks from 'esri/widgets/Bookmarks';
import IExpand from 'esri/widgets/Expand';

loadCss('https://js.arcgis.com/4.21/esri/themes/dark/main.css');

interface Props {
    webmapId: string;
    center: MapCenter;
    zoom: number;
    speed: number;
    isActiveMapPanel: boolean;
    shouldHideAttribution: boolean;
    centerOnChange: (center: MapCenter) => void;
    zoomOnChange: (zoom: number) => void;
    scaleOnChange: (scale: number) => void;
    extentOnChange: (extent: IExtent) => void;
    children?: React.ReactNode;
}

const ZOOM_STEP_FACTOR = 0.6;

const MapView: React.FC<Props> = ({
    webmapId,
    center,
    zoom,
    speed,
    isActiveMapPanel,
    shouldHideAttribution,
    centerOnChange,
    zoomOnChange,
    extentOnChange,
    scaleOnChange,
    children,
}: Props) => {
    const mapDivRef = React.useRef<HTMLDivElement>();

    const isActiveMapRef = useRef<boolean>(isActiveMapPanel);

    const shouldTriggerExtentOnChangeRef = useRef<boolean>(true);

    const mapContainerSizeRef = useRef<string>();

    const [mapView, setMapView] = React.useState<IMapView>(null);

    const initMapView = async () => {
        type Modules = [
            typeof IMapView,
            typeof IWebMap,
            typeof IZoom,
            typeof IBookmarks,
            typeof IExpand
        ];

        try {
            const [
                MapView,
                WebMap,
                Zoom,
                Bookmarks,
                Expand,
            ] = await (loadModules([
                'esri/views/MapView',
                'esri/WebMap',
                'esri/widgets/Zoom',
                'esri/widgets/Bookmarks',
                'esri/widgets/Expand',
                // 'esri/widgets/Attribution'
            ]) as Promise<Modules>);

            const { lon, lat } = center;

            const view = new MapView({
                container: mapDivRef.current,
                map: new WebMap({
                    portalItem: {
                        id: webmapId,
                    },
                }),
                zoom,
                center: [lon, lat],
                navigation: {
                    mouseWheelZoomEnabled: false,
                    browserTouchPanEnabled: false,
                },
                constraints: {
                    rotationEnabled: false,
                },
                ui: {
                    components: shouldHideAttribution ? [] : ['attribution'],
                },
                background: {
                    color: '#000',
                },
            });

            const zoomWidget = new Zoom({
                view,
            });
            if (!shouldHideAttribution) {
                const bookmarks = new Bookmarks({
                    view: view,
                    // allows bookmarks to be added, edited, or deleted
                    editingEnabled: false,
                });
                bookmarks.goToOverride = function (view, goToParams) {
                    goToParams.options = {
                        easing: 'ease',
                        duration:
                            view.center.distance(
                                goToParams.target.targetGeometry.center
                            ) * speed,
                    };
                    return view.goTo(
                        goToParams.target.targetGeometry.center,
                        goToParams.options
                    );
                };

                const bkExpand = new Expand({
                    view: view,
                    content: bookmarks,
                    expanded: true,
                });
                bookmarks.on('bookmark-select', function (event) {
                    bkExpand.expanded = false;
                    return false;
                });

                // Add the widget to the top-right corner of the view
                view.ui.add(bkExpand, 'top-right');
            }

            view.ui.add(zoomWidget, 'top-right');

            view.when(() => {
                setMapView(view);
            });
        } catch (err) {
            console.error(err);
        }
    };

    const updateWebmap = async () => {
        type Modules = [typeof IWebMap];

        try {
            const [WebMap] = await (loadModules(['esri/WebMap']) as Promise<
                Modules
            >);

            mapView.map = new WebMap({
                portalItem: {
                    id: webmapId,
                },
            });
        } catch (err) {
            console.error(err);
        }
    };

    const canZoomRef = useRef<boolean>(true);

    // the type of the input view is IMapView, setting it to any because need to access the view.mapViewNavigation object, which is a private property,
    // therefore has to use any as it's type so the IDE won't throw error
    const addMouseWheelEvent = async (view: any) => {
        view.on('mouse-wheel', (event: WheelEvent) => {
            if (!canZoomRef.current) {
                return;
            }

            const navigation = view.mapViewNavigation;

            // deltaY value is positive when wheel is scrolled up
            // and it is negative when wheel is scrolled down.
            const { deltaY } = event;
            const scaleFactor = 1 / ZOOM_STEP_FACTOR ** ((1 / 60) * deltaY);
            const promise = navigation.zoom(scaleFactor);

            if (promise) {
                canZoomRef.current = false;
                promise
                    //   .catch(() => {})
                    .then(() => {
                        canZoomRef.current = true;
                        navigation.end();
                    });
            }
        });
    };

    const addWatchEvent = async () => {
        type Modules = [typeof IwatchUtils];

        try {
            const [watchUtils] = await (loadModules([
                'esri/core/watchUtils',
            ]) as Promise<Modules>);

            // watchUtils.watch(mapView, 'zoom', (zoom: number) => {
            //     // console.log('zoom on change', zoom)
            //     shouldTriggerExtentOnChangeRef.current = true;
            // });

            watchUtils.watch(mapView, 'center', (center: IPoint) => {
                // console.log('map center on change', center)
                const { longitude, latitude } = center;

                if (isActiveMapRef.current) {
                    centerOnChange({
                        lon: longitude,
                        lat: latitude,
                    });
                }
            });

            watchUtils.whenTrue(mapView, 'stationary', () => {
                if (mapView.zoom === -1) {
                    return;
                }

                if (isActiveMapRef.current) {
                    extentOnChange(mapView.extent);
                    zoomOnChange(mapView.zoom);

                    const { longitude, latitude } = mapView.center;
                    setHashParam(
                        'center',
                        `${longitude.toFixed(3)},${latitude.toFixed(3)}`
                    );
                }

                const containerSize = `${mapView.width}#${mapView.height}`;
                // console.log(containerSize, mapContainerSizeRef.current)

                if (
                    shouldTriggerExtentOnChangeRef.current ||
                    mapContainerSizeRef.current !== containerSize
                ) {
                    shouldTriggerExtentOnChangeRef.current = false;
                    mapContainerSizeRef.current = containerSize;
                    extentOnChange(mapView.extent);
                }

                scaleOnChange(mapView.scale);
            });
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => {
        initMapView();
    }, []);

    useEffect(() => {
        if (mapView) {
            addWatchEvent();
            addMouseWheelEvent(mapView);
        }
    }, [mapView]);

    useEffect(() => {
        if (!mapView || isActiveMapPanel) {
            return;
        }

        const { lon, lat } = center;

        mapView.goTo(
            {
                center: [lon, lat],
            },
            {
                duration: 100,
            }
        );
    }, [center, mapView]);

    useEffect(() => {
        if (!mapView) {
            return;
        }

        if (mapView.zoom === zoom) {
            return;
        }

        shouldTriggerExtentOnChangeRef.current = true;

        mapView.goTo({
            zoom,
        });
    }, [zoom]);

    useEffect(() => {
        isActiveMapRef.current = isActiveMapPanel;
    }, [isActiveMapPanel]);

    useEffect(() => {
        if (!mapView) {
            return;
        }

        updateWebmap();
    }, [webmapId]);

    return (
        <>
            <div
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    right: 0,
                }}
                ref={mapDivRef}
            ></div>
            {mapView
                ? React.Children.map(children, (child) => {
                      return React.cloneElement(
                          child as React.ReactElement<any>,
                          {
                              mapView,
                          }
                      );
                  })
                : null}
        </>
    );
};

export default MapView;
